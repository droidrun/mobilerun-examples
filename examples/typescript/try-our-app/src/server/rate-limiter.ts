export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Counts one attempt against every key, or against none when any is full. */
  consume: (keys: ReadonlyArray<string>) => RateLimitResult;
}

type RateLimiterOptions = {
  max: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
};

const DEFAULT_MAX_KEYS = 10_000;

/** In-memory sliding window. Use a shared store when you run several replicas. */
export function createRateLimiter({
  max,
  windowMs,
  maxKeys = DEFAULT_MAX_KEYS,
  now = Date.now,
}: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, Array<number>>();

  const recent = (key: string, currentTime: number): Array<number> =>
    (hits.get(key) ?? []).filter((at) => at > currentTime - windowMs);

  const prune = (currentTime: number) => {
    for (const key of hits.keys()) {
      if (recent(key, currentTime).length === 0) hits.delete(key);
    }
    while (hits.size >= maxKeys) {
      const oldest = hits.keys().next().value;
      if (oldest === undefined) break;
      hits.delete(oldest);
    }
  };

  return {
    consume(keys) {
      const currentTime = now();
      let retryAt = 0;
      for (const key of keys) {
        const window = recent(key, currentTime);
        if (window.length >= max) {
          retryAt = Math.max(retryAt, (window[0] ?? currentTime) + windowMs);
        }
      }
      if (retryAt > 0) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((retryAt - currentTime) / 1_000),
          ),
        };
      }
      if (keys.some((key) => !hits.has(key))) prune(currentTime);
      for (const key of keys) {
        hits.set(key, [...recent(key, currentTime), currentTime]);
      }
      return { allowed: true };
    },
  };
}
