import { z } from 'zod';
import type { RunStatus } from '@/shared/contracts';

export const upstreamStatusSchema = z.enum([
  'prepared',
  'queued',
  'created',
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
]);

export type UpstreamStatus = z.infer<typeof upstreamStatusSchema>;

export function mapStatus(
  status: UpstreamStatus,
  succeeded: boolean | null | undefined,
): RunStatus {
  switch (status) {
    case 'prepared':
    case 'queued':
    case 'created':
      return 'starting';
    case 'running':
      return 'running';
    case 'cancelling':
      return 'cancelling';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return 'failed';
    case 'completed':
      // The agent can finish a task and still report that it did not succeed.
      return succeeded === false ? 'failed' : 'completed';
  }
}
