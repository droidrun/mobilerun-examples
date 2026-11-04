import type { SessionView, StreamView } from '@/shared/contracts';
import type { CloseReason, SessionStore } from './session-store';

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
  readonly headers: Record<string, string>;

  constructor(
    code: string,
    status: number,
    message: string,
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'DemoError';
    this.code = code;
    this.status = status;
    this.headers = headers;
  }
}

export interface SessionService {
  /** The visitor's running demo, if any. */
  current: (visitorId: string) => SessionView | undefined;
  start: (visitorId: string) => Promise<SessionView>;
  stream: (sessionId: string, visitorId: string) => Promise<StreamView>;
  end: (sessionId: string, visitorId: string) => Promise<void>;
  /** Terminates expired sessions and retries owed terminates. Safe on a timer. */
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
  const starts = new Map<string, Promise<void>>();
  const terminations = new Map<string, Promise<void>>();
  let shuttingDown = false;
  let reaping = false;

  const view = (id: string, expiresAt: number): SessionView => ({
    id,
    expiresInSeconds: Math.max(0, Math.round((expiresAt - now()) / 1_000)),
  });

  const owned = (sessionId: string, visitorId: string) => {
    const record = store.get(sessionId);
    if (!record || record.visitorId !== visitorId) {
      throw new DemoError('not_found', 404, 'Demo session not found.');
    }
    return record;
  };

  /**
   * Terminates the session's device and only then marks the row ended. A
   * failed terminate leaves the row `ending`, so it keeps its slot and the
   * reaper retries it. A device that is already gone (404) counts as done.
   */
  const terminateDevice = async (
    id: string,
    reason: CloseReason,
  ): Promise<void> => {
    const record = store.get(id);
    if (!record || record.state === 'ended') return;
    store.update(id, { state: 'ending', endReason: record.endReason ?? reason });
    if (record.deviceId) {
      try {
        await deps.terminate(record.deviceId);
      } catch (error) {
        if (!isGone(error)) throw error;
      }
    }
    store.update(id, { state: 'ended' });
  };

  /**
   * The one close path for end, reap and shutdown. Concurrent callers share one
   * pending promise. A session that is still booting is only marked `ending`;
   * its start flow owns the device it is about to receive and terminates it.
   */
  const close = (id: string, reason: CloseReason): Promise<void> => {
    const pending = terminations.get(id);
    if (pending) return pending;
    const run = (async () => {
      const booting = starts.get(id);
      if (booting) {
        const record = store.get(id);
        if (record?.state === 'provisioning') {
          store.update(id, { state: 'ending', endReason: reason });
        }
        await booting.catch(() => {});
      }
      await terminateDevice(id, reason);
    })().finally(() => terminations.delete(id));
    terminations.set(id, run);
    return run;
  };

  const assertStarting = (id: string) => {
    if (shuttingDown) {
      throw new DemoError(
        'shutting_down',
        503,
        'The demo is restarting. Try again in a moment.',
      );
    }
    if (store.get(id)?.state !== 'provisioning') {
      throw new DemoError(
        'session_closed',
        410,
        'The demo ended before it was ready.',
      );
    }
  };

  const provision = async (id: string): Promise<void> => {
    try {
      const { deviceId } = await deps.createDevice({ name: `demo-${id}` });
      store.update(id, { deviceId });
      assertStarting(id);
      await deps.waitReady(deviceId, {
        timeoutMs: provisionTimeoutMs,
        signal: abort.signal,
      });
      assertStarting(id);
      await deps.enableKiosk(deviceId, appPackage);
      assertStarting(id);
      await deps.startApp(deviceId, appPackage);
      assertStarting(id);
      store.update(id, { state: 'live', expiresAt: now() + ttlMs });
    } catch (error) {
      // Includes a device that arrived after the session was already closed.
      await terminateDevice(id, 'failed').catch((cleanupError: unknown) => {
        console.error(`cleanup owed for session ${id}`, cleanupError);
      });
      throw error;
    }
  };

  return {
    current(visitorId) {
      const record = store.findActiveByVisitor(visitorId);
      return record?.state === 'live' && record.expiresAt > now()
        ? view(record.id, record.expiresAt)
        : undefined;
    },

    async start(visitorId) {
      if (shuttingDown) {
        throw new DemoError(
          'shutting_down',
          503,
          'The demo is restarting. Try again in a moment.',
        );
      }
      if (store.findActiveByVisitor(visitorId)?.state === 'provisioning') {
        throw new DemoError(
          'session_provisioning',
          409,
          'Your demo is still starting.',
        );
      }
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
      starts.set(id, work);
      try {
        await work;
      } finally {
        starts.delete(id);
      }
      return view(id, now() + ttlMs);
    },

    async stream(sessionId, visitorId) {
      const record = owned(sessionId, visitorId);
      if (record.state === 'provisioning') {
        throw new DemoError(
          'session_provisioning',
          409,
          'Your demo is still starting.',
        );
      }
      if (
        record.state !== 'live' ||
        record.expiresAt <= now() ||
        !record.deviceId
      ) {
        throw new DemoError('session_ended', 410, 'This demo has ended.');
      }
      return deps.retrieveStream(record.deviceId);
    },

    async end(sessionId, visitorId) {
      const record = owned(sessionId, visitorId);
      if (record.state !== 'ended') await close(record.id, 'user');
    },

    async reap() {
      if (reaping) return;
      reaping = true;
      try {
        for (const record of store.listOpen()) {
          if (record.state !== 'ending' && record.expiresAt > now()) continue;
          try {
            await close(record.id, 'expired');
          } catch (error) {
            console.error(`terminate failed for session ${record.id}`, error);
          }
        }
      } finally {
        reaping = false;
      }
    },

    async shutdown() {
      shuttingDown = true;
      abort.abort();
      await Promise.allSettled([...starts.values()]);
      for (const record of store.listOpen()) {
        try {
          await close(record.id, 'shutdown');
        } catch (error) {
          console.error(`terminate failed for session ${record.id}`, error);
        }
      }
    },
  };
}
