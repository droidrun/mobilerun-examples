import { describe, expect, test } from 'bun:test';
import {
  INITIAL_DEMO_STATE,
  demoReducer,
  isLive,
  remainingMs,
  type DemoAction,
  type DemoState,
} from './demo-machine';

const SESSION_ID = '3c118ac1-b69d-4773-a4c2-ab6f072e7557';

function run(actions: Array<DemoAction>, from: DemoState = INITIAL_DEMO_STATE) {
  return actions.reduce(demoReducer, from);
}

const live = run([
  { type: 'configured', sdkConfigured: true },
  { type: 'start' },
  { type: 'started', sessionId: SESSION_ID, deadline: 300_000 },
]);

describe('demo machine', () => {
  test('moves from loading to idle, or to unavailable without an API key', () => {
    expect(run([{ type: 'configured', sdkConfigured: true }]).phase).toBe('idle');
    expect(run([{ type: 'configured', sdkConfigured: false }]).phase).toBe(
      'unavailable',
    );
  });

  test('goes live with a deadline and stream credentials', () => {
    const state = run(
      [{ type: 'stream', stream: { streamUrl: 'wss://stream.example', streamToken: 't' } }],
      live,
    );

    expect(state).toMatchObject({
      phase: 'live',
      sessionId: SESSION_ID,
      streamUrl: 'wss://stream.example',
      streamToken: 't',
    });
    expect(isLive(state)).toBe(true);
    expect(remainingMs(state, 100_000)).toBe(200_000);
    expect(remainingMs(state, 400_000)).toBe(0);
  });

  test('ends by the visitor or by the countdown and can start over', () => {
    expect(run([{ type: 'end' }, { type: 'ended' }], live)).toEqual({
      phase: 'ended',
      endedBy: 'user',
    });
    const expired = run([{ type: 'expired' }], live);
    expect(expired).toEqual({ phase: 'ended', endedBy: 'expired' });
    expect(run([{ type: 'reset' }], expired)).toEqual({ phase: 'idle' });
  });

  test('keeps the demo running when ending fails, and returns to idle when starting fails', () => {
    expect(
      run([{ type: 'end' }, { type: 'failed', message: 'nope' }], live),
    ).toMatchObject({ phase: 'live', error: 'nope' });

    expect(
      run([
        { type: 'configured', sdkConfigured: true },
        { type: 'start' },
        { type: 'failed', message: 'All demo phones are busy.' },
      ]),
    ).toEqual({ phase: 'idle', error: 'All demo phones are busy.' });
  });

  test('ignores actions that do not fit the phase', () => {
    expect(run([{ type: 'start' }]).phase).toBe('loading');
    expect(run([{ type: 'expired' }]).phase).toBe('loading');
  });
});
