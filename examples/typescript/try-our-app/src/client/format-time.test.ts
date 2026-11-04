import { expect, test } from 'bun:test';
import { formatRemaining } from './format-time';

test('formats the countdown as m:ss', () => {
  expect(formatRemaining(300_000)).toBe('5:00');
  expect(formatRemaining(61_001)).toBe('1:02');
  expect(formatRemaining(900)).toBe('0:01');
  expect(formatRemaining(0)).toBe('0:00');
});
