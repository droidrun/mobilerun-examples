import { expect, test } from 'bun:test';
import type { RunView, SessionView } from '@/shared/contracts';
import { ApiError, afterFailedStart } from './use-assistant';

const session = (run: Partial<RunView> | null): SessionView => ({
  persona: { name: 'Wren', role: '' },
  presets: [],
  balance: 80,
  reservePerRun: 20,
  run: run && ({ id: 'run-1', status: 'running', ...run } as RunView),
});

test('a timed-out start that did start a run adopts it; otherwise the error shows', () => {
  const timeout = new DOMException('The operation timed out.', 'TimeoutError');
  expect(afterFailedStart(session({ status: 'unknown' }), timeout)).toBeUndefined();
  expect(afterFailedStart(session({ status: 'starting' }), timeout)).toBeUndefined();

  const unreachable = { at: 'start' as const, text: 'We could not reach the server. Please try again.' };
  expect(afterFailedStart(session({ status: 'completed' }), timeout)).toEqual(unreachable);
  expect(afterFailedStart(session(null), timeout)).toEqual(unreachable);
  expect(afterFailedStart(undefined, timeout)).toEqual(unreachable);

  const refused = new ApiError('run_active', 409, 'You already have a request going.');
  expect(afterFailedStart(session(null), refused)?.text).toBe('You already have a request going.');
});
