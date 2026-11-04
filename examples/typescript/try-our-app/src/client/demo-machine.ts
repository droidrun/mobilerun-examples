import type { StreamView } from '@/shared/contracts';

export type DemoPhase =
  | 'loading'
  | 'unavailable'
  | 'idle'
  | 'starting'
  | 'live'
  | 'ending'
  | 'ended';

/** Who closed the demo, as far as this page knows. */
export type EndedBy = 'expired' | 'user';

export type DemoState = {
  phase: DemoPhase;
  sessionId?: string;
  /** Local-clock time when the demo runs out. */
  deadline?: number;
  streamUrl?: string;
  streamToken?: string;
  endedBy?: EndedBy;
  error?: string;
};

export type DemoAction =
  | { type: 'configured'; sdkConfigured: boolean }
  | { type: 'start' }
  | { type: 'started'; sessionId: string; deadline: number }
  | { type: 'stream'; stream: StreamView }
  | { type: 'end' }
  | { type: 'ended' }
  | { type: 'expired' }
  | { type: 'failed'; message: string }
  | { type: 'reset' };

export const INITIAL_DEMO_STATE: DemoState = { phase: 'loading' };

/** A demo is on screen: running, or being ended. */
export function isLive(state: DemoState): boolean {
  return state.phase === 'live' || state.phase === 'ending';
}

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
    case 'started':
      return state.phase === 'starting'
        ? { phase: 'live', sessionId: action.sessionId, deadline: action.deadline }
        : state;
    case 'stream':
      return isLive(state)
        ? {
            ...state,
            streamUrl: action.stream.streamUrl,
            streamToken: action.stream.streamToken,
          }
        : state;
    case 'end':
      return state.phase === 'live' ? { ...state, phase: 'ending', error: undefined } : state;
    case 'ended':
      return state.phase === 'ending' ? { phase: 'ended', endedBy: 'user' } : state;
    case 'expired':
      // Only the local countdown ran out; the server has not confirmed anything.
      return isLive(state) ? { phase: 'ended', endedBy: 'expired' } : state;
    case 'failed':
      // A failed end leaves the demo running; anything else returns to the start.
      return state.phase === 'ending'
        ? { ...state, phase: 'live', error: action.message }
        : { phase: 'idle', error: action.message };
    case 'reset':
      return state.phase === 'ended' ? { phase: 'idle' } : state;
  }
}
