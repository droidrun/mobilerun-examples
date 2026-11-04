import { describe, expect, test } from 'bun:test';
import { createRateLimiter } from './rate-limiter';

describe('rate limiter', () => {
  test('allows up to max attempts per window, then reports when to retry', () => {
    let clock = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000, now: () => clock });

    expect(limiter.consume(['ip:1'])).toEqual({ allowed: true });
    clock += 10_000;
    expect(limiter.consume(['ip:1'])).toEqual({ allowed: true });
    clock += 10_000;
    expect(limiter.consume(['ip:1'])).toEqual({
      allowed: false,
      retryAfterSeconds: 40,
    });

    clock += 40_000;
    expect(limiter.consume(['ip:1'])).toEqual({ allowed: true });
  });

  test('blocks when any key is full and counts none of them', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000, now: () => 0 });
    limiter.consume(['ip:1', 'visitor:a']);

    expect(limiter.consume(['ip:2', 'visitor:a']).allowed).toBe(false);
    expect(limiter.consume(['ip:2', 'visitor:b']).allowed).toBe(true);
    expect(limiter.consume(['ip:2', 'visitor:c']).allowed).toBe(false);
  });

  test('refuses new keys when full of live windows instead of erasing counters', () => {
    let clock = 0;
    const limiter = createRateLimiter({
      max: 1,
      windowMs: 60_000,
      maxKeys: 2,
      now: () => clock,
    });
    limiter.consume(['a']);
    limiter.consume(['b']);

    expect(limiter.consume(['c'])).toEqual({ allowed: false, retryAfterSeconds: 60 });
    // The counters that were already there are intact.
    expect(limiter.consume(['a']).allowed).toBe(false);

    clock += 60_000;
    expect(limiter.consume(['c']).allowed).toBe(true);
    expect(limiter.consume(['a']).allowed).toBe(true);
  });
});
