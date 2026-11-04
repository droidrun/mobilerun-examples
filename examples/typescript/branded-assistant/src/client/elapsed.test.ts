import { describe, expect, test } from 'bun:test';
import { formatElapsed } from './elapsed';

describe('formatElapsed', () => {
  test('formats minutes and zero-padded seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_999)).toBe('0:09');
    expect(formatElapsed(134_000)).toBe('2:14');
    expect(formatElapsed(3_600_000)).toBe('60:00');
  });

  test('never goes negative when the server clock is ahead', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
  });
});
