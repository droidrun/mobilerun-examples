import { describe, expect, test } from 'bun:test';
import { createRunSessionStore } from './run-session-store';

const CREDENTIALS = {
  streamUrl: 'wss://stream.example/device',
  streamToken: 'short-lived-token',
};

describe('run session store', () => {
  test('expires credentials after the configured TTL', () => {
    let now = 1_000;
    const store = createRunSessionStore({ ttlMs: 100, now: () => now });
    store.set('task-1', CREDENTIALS);

    expect(store.get('task-1')).toEqual(CREDENTIALS);
    now = 1_100;
    expect(store.get('task-1')).toBeUndefined();
  });

  test('evicts the oldest entry at the size limit', () => {
    const store = createRunSessionStore({ maxEntries: 2 });
    store.set('task-1', CREDENTIALS);
    store.set('task-2', CREDENTIALS);
    store.set('task-3', CREDENTIALS);

    expect(store.get('task-1')).toBeUndefined();
    expect(store.get('task-2')).toEqual(CREDENTIALS);
    expect(store.get('task-3')).toEqual(CREDENTIALS);
  });
});
