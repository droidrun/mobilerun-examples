import { describe, expect, test } from 'bun:test';
import {
  createInitialRunnerState,
  runnerReducer,
} from './runner-machine';

const STARTED_RUN = {
  id: 'task-1',
  status: 'running' as const,
  streamUrl: 'wss://stream.example/device',
  streamToken: 'short-lived-token',
};

describe('runner state machine', () => {
  test('moves through start, cancel failure, and terminal polling', () => {
    const active = runnerReducer(createInitialRunnerState(), {
      type: 'start-succeeded',
      run: STARTED_RUN,
    });
    const cancelling = runnerReducer(active, { type: 'cancel-requested' });
    const recovered = runnerReducer(cancelling, {
      type: 'cancel-failed',
      message: 'Try again',
    });
    const terminal = runnerReducer(recovered, {
      type: 'poll-succeeded',
      task: {
        id: 'task-1',
        status: 'completed',
        succeeded: true,
        steps: 4,
        output: { summary: 'Done' },
        finishedAt: '2026-07-30T12:00:00.000Z',
      },
    });

    expect(cancelling.phase).toBe('cancelling');
    expect(recovered.phase).toBe('active');
    expect(recovered.error).toBe('Try again');
    expect(terminal.phase).toBe('terminal');
    expect(terminal.streamUrl).toBe('');
    expect(terminal.streamToken).toBe('');
  });

  test('keeps an active run cancellable after a polling error', () => {
    const active = runnerReducer(createInitialRunnerState(), {
      type: 'start-succeeded',
      run: STARTED_RUN,
    });
    const degraded = runnerReducer(active, {
      type: 'poll-failed',
      message: 'Temporary network error',
    });

    expect(degraded.phase).toBe('active');
    expect(degraded.runId).toBe('task-1');
    expect(degraded.error).toBe('Temporary network error');
  });
});
