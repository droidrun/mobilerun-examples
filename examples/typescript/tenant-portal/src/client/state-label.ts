const LABELS: Record<string, string> = {
  creating: 'Setting up your phone…',
  assigned: 'Starting…',
  ready: 'Online',
  rebooting: 'Restarting…',
  resetting: 'Resetting…',
  migrating: 'Moving your phone…',
  maintenance: 'Under maintenance',
  stopped: 'Stopped',
  terminated: 'Removed',
  unknown: 'Unavailable',
};

/** Device states that settle by themselves, so polling can pause. */
export function isSettled(state: string): boolean {
  return state === 'ready' || state === 'stopped' || state === 'maintenance';
}

export function stateLabel(state: string): string {
  return LABELS[state] ?? state;
}
