import { describe, expect, test } from 'bun:test';
import { ApiClientError, startFailureMessage } from './api-client';

describe('start failure message', () => {
  test('shows the example\'s own text for capacity and rate limits only', () => {
    expect(
      startFailureMessage(
        new ApiClientError('All demo phones are busy.', 503, 'capacity_reached'),
      ),
    ).toBe('All demo phones are busy.');
    expect(
      startFailureMessage(
        new ApiClientError('Try again later.', 429, 'rate_limited'),
      ),
    ).toBe('Try again later.');
  });

  test('hides everything else behind one plain sentence', () => {
    const plain = 'We could not start the demo. Please try again.';

    expect(
      startFailureMessage(
        new ApiClientError('Something went wrong. Please try again.', 500, 'demo_unavailable'),
      ),
    ).toBe(plain);
    expect(
      startFailureMessage(
        new ApiClientError('kiosk: no task found', 500, 'unknown'),
      ),
    ).toBe(plain);
    expect(startFailureMessage(new TypeError('Failed to fetch'))).toBe(plain);
  });
});
