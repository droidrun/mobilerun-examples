import { describe, expect, test } from 'bun:test';
import {
  INITIAL_DEMO_STATE,
  demoReducer,
  remainingMs,
  type DemoAction,
  type DemoState,
} from './demo-machine';

const SESSION = {
  id: '3c118ac1-b69d-4773-a4c2-ab6f072e7557',
  expiresAt: '2030-01-01T00:05:00.000Z',
  serverTime: '2030-01-01T00:00:00.000Z',
};

function run(actions: Array<DemoAction>, from: DemoState = INITIAL_DEMO_STATE) {
  return actions.reduce(demoReducer, from);
}

describe('demo machine', () => {
  test('moves from loading to idle, or to unavailable without an API key', () => {
    expect(run([{ type: 'configured', sdkConfigured: true }]).phase).toBe('idle');
    expect(run([{ type: 'configured', sdkConfigured: false }]).phase).toBe(
      'unavailable',
    );
  });

  test('goes live with a deadline corrected for clock skew', () => {
    // The browser clock runs one minute ahead of the server.
    const receivedAt = Date.parse(SESSION.serverTime) + 60_000;
    const state = run([
      { type: 'configured', sdkConfigured: true },
      { type: 'start' },
      { type: 'started', session: SESSION, receivedAt },
      { type: 'stream', stream: { streamUrl: 'wss://stream.example', streamToken: 't' } },
    ]);

    expect(state).toMatchObject({
      phase: 'live',
      sessionId: SESSION.id,
      streamUrl: 'wss://stream.example',
      streamToken: 't',
    });
    expect(remainingMs(state, receivedAt)).toBe(300_000);
    expect(remainingMs(state, receivedAt + 400_000)).toBe(0);
  });

  test('ends by the visitor or by expiry and can start over', () => {
    const live = run([
      { type: 'configured', sdkConfigured: true },
      { type: 'start' },
      { type: 'started', session: SESSION, receivedAt: Date.parse(SESSION.serverTime) },
    ]);

    expect(run([{ type: 'end' }, { type: 'ended' }], live)).toEqual({
      phase: 'ended',
      endReason: 'user',
    });
    const expired = run([{ type: 'expired' }], live);
    expect(expired).toEqual({ phase: 'ended', endReason: 'expired' });
    expect(run([{ type: 'reset' }], expired)).toEqual({ phase: 'idle' });
  });

  test('keeps the demo running when ending fails, and returns to idle when starting fails', () => {
    const live = run([
      { type: 'configured', sdkConfigured: true },
      { type: 'start' },
      { type: 'started', session: SESSION, receivedAt: Date.parse(SESSION.serverTime) },
    ]);

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
