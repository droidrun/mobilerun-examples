import {
  isTerminalStatus,
  type RunView,
  type SessionView,
} from '@/shared/contracts';

export type ConversationState = {
  phase: 'loading' | 'ready' | 'failed';
  session: SessionView | null;
  /** Oldest first; the last one may still be running. */
  runs: Array<RunView>;
  balance: number;
  error: string | null;
};

export type ConversationAction =
  | { type: 'session-loaded'; session: SessionView }
  | { type: 'session-failed'; message: string }
  | { type: 'run-updated'; run: RunView }
  | { type: 'error'; message: string }
  | { type: 'error-dismissed' };

export function createInitialState(): ConversationState {
  return { phase: 'loading', session: null, runs: [], balance: 0, error: null };
}

export function activeRun(state: ConversationState): RunView | null {
  const last = state.runs.at(-1);
  return last && !isTerminalStatus(last.status) ? last : null;
}

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case 'session-loaded':
      return {
        phase: 'ready',
        session: action.session,
        runs: action.session.runs,
        balance: action.session.balance,
        error: null,
      };
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
