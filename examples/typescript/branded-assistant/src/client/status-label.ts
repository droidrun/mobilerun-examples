import type { RunStatus } from '@/shared/contracts';

export function statusLabel(status: RunStatus): string {
  switch (status) {
    case 'starting':
      return 'Getting started';
    case 'running':
      return 'Working on it';
    case 'cancelling':
      return 'Stopping';
    case 'completed':
      return 'Done';
    case 'failed':
      return "Couldn't finish";
    case 'cancelled':
      return 'Stopped';
  }
}
