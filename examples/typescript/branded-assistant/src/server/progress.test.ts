import { describe, expect, test } from 'bun:test';
import { describeAgentEvent, looksLikeQuestion, mapStatus } from './progress';

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

  test('reads the first usable text field of an untyped agent event', () => {
    expect(describeAgentEvent(null)).toBeNull();
    expect(describeAgentEvent({ steps: 3 })).toBeNull();
    expect(describeAgentEvent({ thought: '  Opening   the site ' })).toBe('Opening the site');
    expect(describeAgentEvent({ thought: 'x'.repeat(500) })?.length).toBe(280);
  });

  test('treats a trailing question mark as a follow-up question', () => {
    expect(looksLikeQuestion('Which city?')).toBe(true);
    expect(looksLikeQuestion('Which city? ')).toBe(true);
    expect(looksLikeQuestion('Searching')).toBe(false);
    expect(looksLikeQuestion(null)).toBe(false);
  });
});
