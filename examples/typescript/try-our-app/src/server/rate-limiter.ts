export type RateLimiter = ReturnType<typeof createRateLimiter>;

type Options = { max: number; windowMs: number; maxKeys?: number; now?: () => number };

/**
 * In-memory fixed window per key. Only expired windows are dropped: when the
 * map is full of live windows, new keys are refused rather than evicting
 * someone's counter. Use a shared store when you run several replicas.
 */
export function createRateLimiter({ max, windowMs, maxKeys = 10_000, now = Date.now }: Options) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  const refuse = (resetAt: number, at: number) => ({
    allowed: false as const,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - at) / 1_000)),
  });

  return {
    /** Counts one attempt against every key, or against none when any of them is full. */
    consume(keys: ReadonlyArray<string>) {
      const at = now();
      for (const [key, window] of windows) if (window.resetAt <= at) windows.delete(key);
      const known = keys.flatMap((key) => windows.get(key) ?? []);
      const full = known.filter((window) => window.count >= max);
      if (full.length > 0) return refuse(Math.max(...full.map((w) => w.resetAt)), at);
      if (windows.size + keys.length - known.length > maxKeys) {
        return refuse(Math.min(...[...windows.values()].map((w) => w.resetAt)), at);
      }
      for (const key of keys) {
        const window = windows.get(key);
        if (window) window.count += 1;
        else windows.set(key, { count: 1, resetAt: at + windowMs });
      }
      return { allowed: true as const };
    },
  };
}
