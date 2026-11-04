import {
  isTerminalStatus,
  type Persona,
  type PublicPreset,
  type RunView,
  type SessionView,
} from '@/shared/contracts';

export type ConversationState = {
  phase: 'loading' | 'ready' | 'failed';
  persona: Persona | null;
  presets: Array<PublicPreset>;
  reservePerRun: number | null;
  sdkConfigured: boolean;
  deviceCount: number;
  /** The one balance the UI shows. */
  balance: number | null;
  /** Oldest first. A user has at most one active run, and it is the last. */
  runs: Array<RunView>;
  error: string | null;
};

export type ConversationAction =
  | { type: 'session-loaded'; session: SessionView }
  /** Re-read after a failed start: adopt a run the server did start. */
  | { type: 'session-refreshed'; session: SessionView }
  | { type: 'session-failed'; message: string }
  | { type: 'run-updated'; run: RunView }
  | { type: 'error'; message: string }
  | { type: 'error-dismissed' };

export function createInitialState(): ConversationState {
  return {
    phase: 'loading',
    persona: null,
    presets: [],
    reservePerRun: null,
    sdkConfigured: true,
    deviceCount: 0,
    balance: null,
    runs: [],
    error: null,
  };
}

export function activeRun(state: ConversationState): RunView | null {
  const last = state.runs.at(-1);
  return last && !isTerminalStatus(last.status) ? last : null;
}

function fromSession(
  state: ConversationState,
  session: SessionView,
): ConversationState {
  return {
    ...state,
    phase: 'ready',
    persona: session.persona,
    presets: session.presets,
    reservePerRun: session.reservePerRun,
    sdkConfigured: session.sdkConfigured,
    deviceCount: session.deviceCount,
    balance: session.balance,
    runs: session.runs,
  };
}

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case 'session-loaded':
      return { ...fromSession(state, action.session), error: null };
    case 'session-refreshed': {
      const next = fromSession(state, action.session);
      // Found a run we did not know about: the start worked after all.
      return { ...next, error: activeRun(next) ? null : state.error };
    }
    case 'session-failed':
      return { ...state, phase: 'failed', error: action.message };
    case 'run-updated': {
      const index = state.runs.findIndex((run) => run.id === action.run.id);
      const runs =
        index === -1
          ? [...state.runs, action.run]
          : state.runs.map((run, position) => (position === index ? action.run : run));
      return { ...state, runs, balance: action.run.balance, error: null };
    }
    case 'error':
      return { ...state, error: action.message };
    case 'error-dismissed':
      return { ...state, error: null };
  }
}
