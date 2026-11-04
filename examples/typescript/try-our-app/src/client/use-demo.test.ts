import { expect, test } from 'bun:test';
import { RequestError, startNotice } from './use-demo';

test('only this server\'s own capacity and rate limits show their text; everything else is one plain sentence', () => {
  expect(startNotice(new RequestError('capacity_reached', 'All demo phones are busy.'))).toEqual({
    tone: 'warn',
    text: 'All demo phones are busy.',
  });
  expect(startNotice(new RequestError('rate_limited', 'Try again later.')).text).toBe('Try again later.');

  const plain = { tone: 'danger' as const, text: 'We could not start the demo. Please try again.' };
  expect(startNotice(new RequestError('demo_unavailable', 'kiosk: no task found'))).toEqual(plain);
  expect(startNotice(new TypeError('Failed to fetch'))).toEqual(plain);
});
