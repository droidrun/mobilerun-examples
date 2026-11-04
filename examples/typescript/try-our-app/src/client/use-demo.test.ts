import { expect, test } from 'bun:test';
import { ApiError, startNotice } from './use-demo';

test('only this server\'s own capacity and rate limits show their text; everything else is one plain sentence', () => {
  expect(startNotice(new ApiError('capacity_reached', 503, 'All demo phones are busy.'))).toEqual({
    tone: 'warn',
    text: 'All demo phones are busy.',
  });
  expect(startNotice(new ApiError('rate_limited', 429, 'Try again later.')).text).toBe('Try again later.');

  const plain = { tone: 'danger' as const, text: 'We could not start the demo. Please try again.' };
  expect(startNotice(new ApiError('upstream_rejected', 422, 'kiosk: no task found'))).toEqual(plain);
  expect(startNotice(new TypeError('Failed to fetch'))).toEqual(plain);
});
