import type { SessionView, StreamView } from '@/shared/contracts';
import type {
  EndReason,
  SessionRecord,
  SessionStore,
} from './session-store';

/** The device operations the demo needs. The only SDK-facing seam. */
export type DemoDeviceDeps = {
  createDevice: (input: { name: string }) => Promise<{ deviceId: string }>;
  waitReady: (
    deviceId: string,
    options: { timeoutMs: number; signal: AbortSignal },
  ) => Promise<void>;
  enableKiosk: (deviceId: string, packageName: string) => Promise<void>;
  startApp: (deviceId: string, packageName: string) => Promise<void>;
  retrieveStream: (deviceId: string) => Promise<StreamView>;
  terminate: (deviceId: string) => Promise<void>;
};

export class DemoError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'DemoError';
    this.code = code;
    this.status = status;
  }
}

export interface SessionService {
  /** The visitor's running demo, if any. Throws while one is still booting. */
  current: (visitorId: string) => SessionView | undefined;
  start: (visitorId: string) => Promise<SessionView>;
  stream: (sessionId: string, visitorId: string) => Promise<StreamView>;
  end: (sessionId: string, visitorId: string) => Promise<void>;
  /** Terminates every expired session. Safe to call on a timer. */
  reap: () => Promise<void>;
  /** Stops new starts, then terminates every open session. */
  shutdown: () => Promise<void>;
}

type SessionServiceOptions = {
  deps: DemoDeviceDeps;
  store: SessionStore;
  appPackage: string;
  ttlMs: number;
  provisionTimeoutMs: number;
  maxConcurrent: number;
  now?: () => number;
  newId?: () => string;
};

function isGone(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 404
  );
}

export function createSessionService({
  deps,
  store,
  appPackage,
  ttlMs,
  provisionTimeoutMs,
  maxConcurrent,
  now = Date.now,
  newId = () => crypto.randomUUID(),
}: SessionServiceOptions): SessionService {
  const abort = new AbortController();
  const inflight = new Set<Promise<unknown>>();
  let closing = false;
  let reaping = false;

  const view = (record: Pick<SessionRecord, 'id' | 'expiresAt'>): SessionView => ({
    id: record.id,
    expiresAt: new Date(record.expiresAt).toISOString(),
    serverTime: new Date(now()).toISOString(),
  });

  const assertRunning = () => {
    if (closing) {
      throw new DemoError(
        'shutting_down',
        503,
        'The demo is restarting. Try again in a moment.',
      );
    }
  };

  /** Terminates the device, then records the end. Keeps the row open on failure so the reaper retries. */
  const close = async (
    record: SessionRecord,
    reason: EndReason,
  ): Promise<void> => {
    if (record.deviceId) {
      try {
        await deps.terminate(record.deviceId);
      } catch (error) {
        if (!isGone(error)) throw error;
      }
    }
    store.update(record.id, { state: 'ended', endReason: reason });
  };

  const owned = (sessionId: string, visitorId: string): SessionRecord => {
    const record = store.get(sessionId);
    if (!record || record.visitorId !== visitorId) {
      throw new DemoError('not_found', 404, 'Demo session not found.');
    }
    return record;
  };

  const provision = async (id: string): Promise<void> => {
    let deviceId: string | null = null;
    try {
      deviceId = (await deps.createDevice({ name: `demo-${id}` })).deviceId;
      store.update(id, { deviceId });
      assertRunning();
      await deps.waitReady(deviceId, {
        timeoutMs: provisionTimeoutMs,
        signal: abort.signal,
      });
      assertRunning();
      await deps.enableKiosk(deviceId, appPackage);
      assertRunning();
      await deps.startApp(deviceId, appPackage);
      assertRunning();
    } catch (error) {
      if (deviceId) {
        await deps.terminate(deviceId).catch((terminateError: unknown) => {
          if (!isGone(terminateError)) {
            console.error('terminate after failed start failed', terminateError);
          }
        });
      }
      store.update(id, { state: 'ended', endReason: 'failed' });
      throw error;
    }
  };

  return {
    current(visitorId) {
      const record = store.findOpenByVisitor(visitorId);
      if (!record) return undefined;
      if (record.state === 'provisioning') {
        throw new DemoError(
          'session_provisioning',
          409,
          'Your demo is still starting.',
        );
      }
      return record.expiresAt > now() ? view(record) : undefined;
    },

    async start(visitorId) {
      assertRunning();
      if (store.countOpen() >= maxConcurrent) {
        throw new DemoError(
          'capacity_reached',
          503,
          'All demo phones are busy. Try again in a few minutes.',
        );
      }

      const id = newId();
      const createdAt = now();
      store.insert({
        id,
        visitorId,
        deviceId: null,
        state: 'provisioning',
        createdAt,
        // A stuck start is swept once it could no longer be booting.
        expiresAt: createdAt + provisionTimeoutMs + ttlMs,
        endReason: null,
      });

      const work = provision(id);
      inflight.add(work);
      try {
        await work;
      } finally {
        inflight.delete(work);
      }

      const expiresAt = now() + ttlMs;
      store.update(id, { state: 'live', expiresAt });
      return view({ id, expiresAt });
    },

    async stream(sessionId, visitorId) {
      const record = owned(sessionId, visitorId);
      if (record.state === 'ended' || record.expiresAt <= now()) {
        throw new DemoError('session_ended', 410, 'This demo has ended.');
      }
      if (record.state === 'provisioning' || !record.deviceId) {
        throw new DemoError(
          'session_provisioning',
          409,
          'Your demo is still starting.',
        );
      }
      return deps.retrieveStream(record.deviceId);
    },

    async end(sessionId, visitorId) {
      const record = owned(sessionId, visitorId);
      if (record.state === 'ended') return;
      await close(record, 'user');
    },

    async reap() {
      if (reaping) return;
      reaping = true;
      try {
        const currentTime = now();
        for (const record of store.listOpen()) {
          if (record.expiresAt > currentTime) continue;
          try {
            await close(record, 'expired');
          } catch (error) {
            console.error(`terminate failed for session ${record.id}`, error);
          }
        }
      } finally {
        reaping = false;
      }
    },

    async shutdown() {
      closing = true;
      abort.abort();
      await Promise.allSettled([...inflight]);
      for (const record of store.listOpen()) {
        try {
          await close(record, 'shutdown');
        } catch (error) {
          console.error(`terminate failed for session ${record.id}`, error);
        }
      }
    },
  };
}
