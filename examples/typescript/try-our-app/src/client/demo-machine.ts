import type { SessionView, StreamView } from '@/shared/contracts';

export type DemoPhase =
  | 'loading'
  | 'unavailable'
  | 'idle'
  | 'starting'
  | 'live'
  | 'ending'
  | 'ended';

export type EndReason = 'expired' | 'user';

export type DemoState = {
  phase: DemoPhase;
  sessionId?: string;
  /** Local-clock deadline, corrected for the server/browser clock offset. */
  deadline?: number;
  streamUrl?: string;
  streamToken?: string;
  endReason?: EndReason;
  error?: string;
};

export type DemoAction =
  | { type: 'configured'; sdkConfigured: boolean }
  | { type: 'start' }
  | { type: 'started'; session: SessionView; receivedAt: number }
  | { type: 'stream'; stream: StreamView }
  | { type: 'end' }
  | { type: 'ended' }
  | { type: 'expired' }
  | { type: 'failed'; message: string }
  | { type: 'reset' };

export const INITIAL_DEMO_STATE: DemoState = { phase: 'loading' };

export function remainingMs(state: DemoState, now: number): number {
  return state.deadline === undefined ? 0 : Math.max(0, state.deadline - now);
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case 'configured':
      return state.phase === 'loading'
        ? { phase: action.sdkConfigured ? 'idle' : 'unavailable' }
        : state;
    case 'start':
      return state.phase === 'idle' ? { phase: 'starting' } : state;
    case 'started': {
      if (state.phase !== 'starting') return state;
      const offset =
        Date.parse(action.session.serverTime) - action.receivedAt;
      return {
        phase: 'live',
        sessionId: action.session.id,
        deadline: Date.parse(action.session.expiresAt) - offset,
      };
    }
    case 'stream':
      return state.phase === 'live' || state.phase === 'ending'
        ? {
            ...state,
            streamUrl: action.stream.streamUrl,
            streamToken: action.stream.streamToken,
          }
        : state;
    case 'end':
      return state.phase === 'live' ? { ...state, phase: 'ending', error: undefined } : state;
    case 'ended':
      return state.phase === 'ending'
        ? { phase: 'ended', endReason: 'user' }
        : state;
    case 'expired':
      return state.phase === 'live' || state.phase === 'ending'
        ? { phase: 'ended', endReason: 'expired' }
        : state;
    case 'failed':
      // A failed end leaves the demo running; anything else returns to the start.
      return state.phase === 'ending'
        ? { ...state, phase: 'live', error: action.message }
        : { phase: 'idle', error: action.message };
    case 'reset':
      return state.phase === 'ended' ? { phase: 'idle' } : state;
  }
}
