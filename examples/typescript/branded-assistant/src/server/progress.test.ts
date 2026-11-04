import { describe, expect, test } from 'bun:test';
import { mapStatus } from './progress';

describe('progress helpers', () => {
  test('maps Mobilerun task states to run states', () => {
    expect(mapStatus('queued', null)).toBe('starting');
    expect(mapStatus('created', null)).toBe('starting');
    expect(mapStatus('running', null)).toBe('running');
    expect(mapStatus('cancelling', null)).toBe('cancelling');
    expect(mapStatus('completed', true)).toBe('completed');
    expect(mapStatus('completed', false)).toBe('failed');
    expect(mapStatus('failed', null)).toBe('failed');
    expect(mapStatus('cancelled', null)).toBe('cancelled');
  });
});
