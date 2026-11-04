import { describe, expect, test } from 'bun:test';
import type { RunView, SessionView } from '@/shared/contracts';
import {
  activeRun,
  conversationReducer,
  createInitialState,
} from './conversation-machine';

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: 'run-1',
    presetId: 'hotel',
    request: 'Lisbon',
    status: 'running',
    steps: null,
    timeline: [],
    question: null,
    result: null,
    message: null,
    reserved: 20,
    charged: null,
    balance: 80,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const session: SessionView = {
  persona: { displayName: 'Pip', tagline: '' },
  presets: [],
  balance: 100,
  reservePerRun: 20,
  sdkConfigured: true,
  deviceCount: 1,
  runs: [run({ status: 'completed', charged: 5, balance: 95 })],
};

describe('conversation machine', () => {
  test('loads the session with its history and balance', () => {
    const state = conversationReducer(createInitialState(), { type: 'session-loaded', session });
    expect(state).toMatchObject({ phase: 'ready', balance: 100 });
    expect(activeRun(state)).toBeNull();
  });

  test('adds a new run, then updates it in place and tracks the balance', () => {
    let state = conversationReducer(createInitialState(), { type: 'session-loaded', session });
    state = conversationReducer(state, { type: 'run-updated', run: run({ id: 'run-2' }) });
    expect(state.runs.map((item) => item.id)).toEqual(['run-1', 'run-2']);
    expect(activeRun(state)?.id).toBe('run-2');
    expect(state.balance).toBe(80);

    state = conversationReducer(state, {
      type: 'run-updated',
      run: run({ id: 'run-2', status: 'completed', charged: 4, balance: 96 }),
    });
    expect(state.runs).toHaveLength(2);
    expect(activeRun(state)).toBeNull();
    expect(state.balance).toBe(96);
  });

  test('keeps errors separate from run state', () => {
    let state = conversationReducer(createInitialState(), { type: 'session-loaded', session });
    state = conversationReducer(state, { type: 'error', message: 'Not enough credits' });
    expect(state.error).toBe('Not enough credits');
    expect(conversationReducer(state, { type: 'error-dismissed' }).error).toBeNull();
  });
});
