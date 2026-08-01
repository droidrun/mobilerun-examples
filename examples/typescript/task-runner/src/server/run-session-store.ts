export type StreamCredentials = {
  streamUrl: string;
  streamToken: string;
};

export interface RunSessionStore {
  get: (taskId: string) => StreamCredentials | undefined;
  set: (taskId: string, credentials: StreamCredentials) => void;
  delete: (taskId: string) => void;
}

type StoredCredentials = {
  credentials: StreamCredentials;
  expiresAt: number;
};

type RunSessionStoreOptions = {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
};

const DEFAULT_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = 1_000;

export function createRunSessionStore({
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = Date.now,
}: RunSessionStoreOptions = {}): RunSessionStore {
  const entries = new Map<string, StoredCredentials>();

  const pruneExpired = () => {
    const currentTime = now();
    for (const [taskId, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(taskId);
    }
  };

  return {
    get(taskId) {
      const entry = entries.get(taskId);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(taskId);
        return undefined;
      }
      return entry.credentials;
    },
    set(taskId, credentials) {
      pruneExpired();
      if (!entries.has(taskId) && entries.size >= maxEntries) {
        const oldestTaskId = entries.keys().next().value;
        if (oldestTaskId) entries.delete(oldestTaskId);
      }
      entries.set(taskId, {
        credentials,
        expiresAt: now() + ttlMs,
      });
    },
    delete(taskId) {
      entries.delete(taskId);
    },
  };
}
