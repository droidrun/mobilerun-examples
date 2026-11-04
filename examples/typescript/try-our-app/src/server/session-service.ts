import type Mobilerun from '@mobilerun/sdk';
import type { SessionView, StreamView } from '@/shared/contracts';
import type { SessionStore } from './session-store';

const KIOSK_RETRIES = 5;
const KIOSK_RETRY_DELAY_MS = 1_000;

/** A refusal of this server's own, with an HTTP status and text a visitor may read. */
export class DemoError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

const notFound = () => new DemoError('not_found', 404, 'Demo session not found.');
const restarting = () =>
  new DemoError('shutting_down', 503, 'The demo is restarting. Try again in a moment.');
const stillStarting = () =>
  new DemoError('session_provisioning', 409, 'Your demo is still starting.');
const isGone = (error: unknown) => (error as { status?: unknown } | null)?.status === 404;
const noTaskYet = (error: unknown) =>
  error instanceof Error && /no task found/i.test(error.message);
const logOwed = (id: string) => (error: unknown) =>
  console.error(`terminate owed for session ${id}; the reaper retries it`, error);

type Options = {
  client: Mobilerun;
  store: SessionStore;
  appPackage: string;
  ttlMs: number;
  provisionTimeoutMs: number;
  maxConcurrent: number;
  /** Seams for tests. */
  now?: () => number;
  newId?: () => string;
  sleep?: (ms: number) => Promise<void>;
};

export type SessionService = ReturnType<typeof createSessionService>;

/** The demo lifecycle, and every @mobilerun/sdk call this example makes. */
export function createSessionService(options: Options) {
  const { client, store, appPackage, ttlMs, provisionTimeoutMs, maxConcurrent } = options;
  const { now = Date.now, newId = () => crypto.randomUUID(), sleep = Bun.sleep } = options;
  const { devices } = client;
  const abort = new AbortController(); // interrupts phones still booting at shutdown
  const starts = new Map<string, Promise<void>>();
  const closing = new Map<string, Promise<void>>();
  let shuttingDown = false;

  const owned = (id: string, visitorId: string) => {
    const row = store.get(id);
    if (row?.visitorId !== visitorId) throw notFound();
    return row;
  };

  /**
   * The one cleanup path. The row is ended only once the phone is gone (a 404 counts as gone);
   * a failed terminate leaves it `ending`, holding its slot, for the reaper to retry.
   */
  const terminate = async (id: string) => {
    const row = store.get(id);
    if (!row || row.state === 'ended') return;
    store.update(id, { state: 'ending' });
    if (row.deviceId) {
      await devices.terminate(row.deviceId).catch((error: unknown) => {
        if (!isGone(error)) throw error;
      });
    }
    store.update(id, { state: 'ended' });
  };

  /**
   * End, reap and shutdown close through here and share one promise per session. A session
   * still booting is only marked `ending`: its start flow terminates the phone when it arrives.
   */
  const close = (id: string): Promise<void> => {
    const pending = closing.get(id);
    if (pending) return pending;
    const run = (async () => {
      const booting = starts.get(id);
      if (booting) {
        if (store.get(id)?.state === 'provisioning') store.update(id, { state: 'ending' });
        await booting.catch(() => {});
      }
      await terminate(id);
    })().finally(() => closing.delete(id));
    closing.set(id, run);
    return run;
  };

  /** Throws once the session was closed while booting: its device is terminated, never promoted. */
  const stillWanted = (id: string) => {
    if (shuttingDown) throw restarting();
    if (store.get(id)?.state !== 'provisioning') {
      throw new DemoError('session_closed', 410, 'The demo ended before it was ready.');
    }
  };

  /** Kiosk pins a running task, which can lag behind apps.start: retry while it is missing. */
  const enableKiosk = async (deviceId: string) => {
    for (let retry = 0; ; retry += 1) {
      try {
        // SDK retries are off so this loop is the only one.
        return await devices.kiosk.enable(deviceId, { packageName: appPackage }, { maxRetries: 0 });
      } catch (error) {
        if (!noTaskYet(error) || retry >= KIOSK_RETRIES) throw error;
        await sleep(KIOSK_RETRY_DELAY_MS);
      }
    }
  };

  const provision = async (id: string) => {
    try {
      // No automatic retries: a retried create could leave a second, untracked phone.
      const device = await devices.create(
        { deviceType: 'android_cloud_phone', name: `demo-${id}` },
        { maxRetries: 0 },
      );
      store.update(id, { deviceId: device.id });
      stillWanted(id);
      await devices.waitReady(device.id, { timeout: provisionTimeoutMs, signal: abort.signal });
      stillWanted(id);
      await devices.apps.start(appPackage, { deviceId: device.id }); // app first, then kiosk
      stillWanted(id);
      await enableKiosk(device.id);
      stillWanted(id);
      store.update(id, { state: 'live', expiresAt: now() + ttlMs });
    } catch (error) {
      await terminate(id).catch(logOwed(id));
      throw error;
    }
  };

  return {
    /** The visitor's running demo, if any. */
    current(visitorId: string): SessionView | undefined {
      const row = store.activeFor(visitorId);
      if (row?.state !== 'live' || row.expiresAt <= now()) return undefined;
      return { id: row.id, expiresInSeconds: Math.round((row.expiresAt - now()) / 1_000) };
    },

    async start(visitorId: string): Promise<SessionView> {
      if (shuttingDown) throw restarting();
      if (store.activeFor(visitorId)?.state === 'provisioning') throw stillStarting();
      if (store.open().length >= maxConcurrent) {
        throw new DemoError('capacity_reached', 503, 'All demo phones are busy. Try again soon.');
      }
      const id = newId();
      // A start that hangs is swept once it can no longer be booting.
      const expiresAt = now() + provisionTimeoutMs + ttlMs;
      store.insert({ id, visitorId, deviceId: null, state: 'provisioning', expiresAt });
      const work = provision(id);
      starts.set(id, work);
      await work.finally(() => starts.delete(id));
      return { id, expiresInSeconds: ttlMs / 1_000 };
    },

    async stream(id: string, visitorId: string): Promise<StreamView> {
      const row = owned(id, visitorId);
      if (row.state === 'provisioning') throw stillStarting();
      if (row.state !== 'live' || row.expiresAt <= now() || !row.deviceId) {
        throw new DemoError('session_ended', 410, 'This demo has ended.');
      }
      const device = await devices.retrieve(row.deviceId);
      return { streamUrl: device.streamUrl, streamToken: device.streamToken ?? undefined };
    },

    async end(id: string, visitorId: string) {
      if (owned(id, visitorId).state !== 'ended') await close(id);
    },

    /** Closes expired sessions and retries owed terminates. Overlapping runs share each close. */
    async reap() {
      for (const row of store.open()) {
        if (row.state !== 'ending' && row.expiresAt > now()) continue;
        await close(row.id).catch(logOwed(row.id));
      }
    },

    /** Refuses new starts, interrupts phones still booting, then closes every open session. */
    async shutdown() {
      shuttingDown = true;
      abort.abort();
      await Promise.all(store.open().map((row) => close(row.id).catch(logOwed(row.id))));
    },
  };
}
