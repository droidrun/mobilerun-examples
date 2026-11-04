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

// The API returns the agent's latest event as an untyped object, so progress
// text is a best-effort read of the usual text fields. A task without any of
// them still shows step counts.
const TEXT_KEYS = [
  'thought',
  'plan',
  'response',
  'message',
  'text',
  'summary',
  'reasoning',
] as const;

const MAX_TEXT_LENGTH = 280;

export function describeAgentEvent(
  event: Record<string, unknown> | null | undefined,
): string | null {
  if (!event) return null;
  for (const key of TEXT_KEYS) {
    const value = event[key];
    if (typeof value === 'string' && value.trim()) {
      const text = value.trim().replace(/\s+/g, ' ');
      return text.length > MAX_TEXT_LENGTH
        ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…`
        : text;
    }
  }
  return null;
}

/**
 * Mobilerun has no "waiting for input" state. The example treats an agent
 * message that ends in a question mark as a follow-up question; the user can
 * also message the agent at any time while it runs.
 */
export function looksLikeQuestion(text: string | null): boolean {
  return text !== null && text.trimEnd().endsWith('?');
}
