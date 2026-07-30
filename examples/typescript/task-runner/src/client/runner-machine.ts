import {
  isTerminalStatus,
  type RunTaskResponse,
  type TaskStatus,
  type TaskView,
} from '@/shared/contracts';

export const RUNNER_PHASES = [
  'idle',
  'starting',
  'active',
  'cancelling',
  'terminal',
  'error',
] as const;

export type RunnerPhase = (typeof RUNNER_PHASES)[number];

export type RunnerState = {
  phase: RunnerPhase;
  runId: string | null;
  status: TaskStatus | null;
  task: TaskView | null;
  streamUrl: string;
  streamToken: string;
  error: string | null;
};

export type RunnerAction =
  | { type: 'start-requested' }
  | { type: 'start-succeeded'; run: RunTaskResponse }
  | { type: 'start-failed'; message: string }
  | { type: 'poll-succeeded'; task: TaskView }
  | { type: 'poll-failed'; message: string }
  | { type: 'cancel-requested' }
  | { type: 'cancel-failed'; message: string }
  | { type: 'reset' };

export function createInitialRunnerState(): RunnerState {
  return {
    phase: 'idle',
    runId: null,
    status: null,
    task: null,
    streamUrl: '',
    streamToken: '',
    error: null,
  };
}

export function runnerReducer(
  state: RunnerState,
  action: RunnerAction,
): RunnerState {
  switch (action.type) {
    case 'start-requested':
      return { ...createInitialRunnerState(), phase: 'starting' };
    case 'start-succeeded':
      const startedTerminal = isTerminalStatus(action.run.status);
      return {
        ...createInitialRunnerState(),
        phase: startedTerminal ? 'terminal' : 'active',
        runId: action.run.id,
        status: action.run.status,
        streamUrl: startedTerminal ? '' : (action.run.streamUrl ?? ''),
        streamToken: startedTerminal ? '' : (action.run.streamToken ?? ''),
      };
    case 'start-failed':
      return {
        ...createInitialRunnerState(),
        phase: 'error',
        error: action.message,
      };
    case 'poll-succeeded':
      const terminal = isTerminalStatus(action.task.status);
      return {
        ...state,
        phase: terminal
          ? 'terminal'
          : state.phase === 'cancelling'
            ? 'cancelling'
            : 'active',
        status: action.task.status,
        task: action.task,
        streamUrl: terminal
          ? ''
          : (action.task.streamUrl ?? state.streamUrl),
        streamToken: terminal
          ? ''
          : (action.task.streamToken ?? state.streamToken),
        error: null,
      };
    case 'poll-failed':
      return { ...state, error: action.message };
    case 'cancel-requested':
      return state.phase === 'active'
        ? { ...state, phase: 'cancelling', error: null }
        : state;
    case 'cancel-failed':
      return state.phase === 'cancelling'
        ? { ...state, phase: 'active', error: action.message }
        : state;
    case 'reset':
      return createInitialRunnerState();
  }
}
