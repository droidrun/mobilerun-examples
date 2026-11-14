import type { RunnerState } from './runner-machine';

export function statusLabel(
  state: RunnerState,
  connected: boolean,
): string {
  if (state.phase === 'starting') return 'Dispatching task';
  if (state.phase === 'cancelling') return 'Stopping task';
  if (state.phase === 'error') return 'Runner error';
  if (state.status === 'queued') return 'Task queued';
  if (state.status === 'prepared') return 'Task prepared';
  if (state.status === 'created') return 'Preparing task';
  if (state.status === 'cancelling') return 'Stopping task';
  if (state.status === 'completed') return 'Task completed';
  if (state.status === 'failed') return 'Task failed';
  if (state.status === 'cancelled') return 'Task cancelled';
  if (connected) return 'Device live';
  if (state.status === 'running') return 'Task running';
  return 'Ready to run';
}
