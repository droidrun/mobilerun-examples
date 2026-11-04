import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { StartRunRequest } from '@/shared/contracts';
import { assistantApi } from './api-client';
import {
  activeRun,
  conversationReducer,
  createInitialState,
} from './conversation-machine';

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 15_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function requestSignal(parent: AbortSignal): AbortSignal {
  return AbortSignal.any([parent, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}

export function useAssistant() {
  const [state, dispatch] = useReducer(
    conversationReducer,
    undefined,
    createInitialState,
  );
  // Aborts everything in flight when the component unmounts.
  const lifetime = useRef<AbortController | null>(null);
  const active = activeRun(state);
  const activeId = active?.id ?? null;

  const signal = useCallback((): AbortSignal => {
    lifetime.current ??= new AbortController();
    return requestSignal(lifetime.current.signal);
  }, []);

  const loadSession = useCallback(() => {
    assistantApi
      .session(signal())
      .then((session) => dispatch({ type: 'session-loaded', session }))
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          dispatch({ type: 'session-failed', message: errorMessage(error) });
        }
      });
  }, [signal]);

  useEffect(() => {
    lifetime.current = new AbortController();
    loadSession();
    return () => {
      lifetime.current?.abort();
      lifetime.current = null;
    };
  }, [loadSession]);

  /** Runs a call; true when it succeeded. Errors become the visible error. */
  const attempt = useCallback(
    async (call: () => Promise<void>): Promise<boolean> => {
      try {
        await call();
        return true;
      } catch (error) {
        if (!isAbortError(error)) {
          dispatch({ type: 'error', message: errorMessage(error) });
        }
        return false;
      }
    },
    [],
  );

  const start = useCallback(
    async (input: StartRunRequest): Promise<boolean> => {
      const ok = await attempt(async () => {
        const run = await assistantApi.start(input, signal());
        dispatch({ type: 'run-updated', run });
      });
      if (!ok) {
        // A timed-out start may still have started a run. Look before the
        // user is offered a second start.
        await assistantApi
          .session(signal())
          .then((session) => dispatch({ type: 'session-refreshed', session }))
          .catch(() => undefined);
      }
      return ok;
    },
    [attempt, signal],
  );

  const reply = useCallback(
    (message: string): Promise<boolean> =>
      activeId
        ? attempt(async () => {
            const run = await assistantApi.sendMessage(activeId, message, signal());
            dispatch({ type: 'run-updated', run });
          })
        : Promise.resolve(false),
    [activeId, attempt, signal],
  );

  const cancel = useCallback(async () => {
    if (!activeId) return;
    await attempt(async () => {
      const run = await assistantApi.cancel(activeId, signal());
      dispatch({ type: 'run-updated', run });
    });
  }, [activeId, attempt, signal]);

  // Serial polling of the active run: one request at a time, backing off on
  // errors. The server answers from what its own watcher recorded.
  useEffect(() => {
    if (!activeId) return;
    const polling = new AbortController();
    let timer: number | undefined;
    let interval = POLL_INTERVAL_MS;

    const poll = async () => {
      try {
        const run = await assistantApi.run(activeId, requestSignal(polling.signal));
        if (!polling.signal.aborted) {
          interval = POLL_INTERVAL_MS;
          dispatch({ type: 'run-updated', run });
        }
      } catch (error) {
        if (!isAbortError(error)) {
          interval = Math.min(interval * 2, MAX_POLL_INTERVAL_MS);
          dispatch({ type: 'error', message: errorMessage(error) });
        }
      } finally {
        if (!polling.signal.aborted) timer = window.setTimeout(poll, interval);
      }
    };

    timer = window.setTimeout(poll, interval);
    return () => {
      polling.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeId]);

  return {
    state,
    active,
    start,
    reply,
    cancel,
    reload: loadSession,
    dismissError: () => dispatch({ type: 'error-dismissed' }),
  };
}
