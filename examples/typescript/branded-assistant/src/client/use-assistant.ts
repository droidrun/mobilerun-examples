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
  const controller = useRef(new AbortController());
  const active = activeRun(state);
  const activeId = active?.id ?? null;

  const loadSession = useCallback(() => {
    assistantApi
      .session(requestSignal(controller.current.signal))
      .then((session) => dispatch({ type: 'session-loaded', session }))
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          dispatch({ type: 'session-failed', message: errorMessage(error) });
        }
      });
  }, []);

  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    loadSession();
    return () => current.abort();
  }, [loadSession]);

  const guarded = useCallback(
    async <T,>(call: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
      try {
        return await call(requestSignal(controller.current.signal));
      } catch (error) {
        if (!isAbortError(error)) {
          dispatch({ type: 'error', message: errorMessage(error) });
        }
        return undefined;
      }
    },
    [],
  );

  const start = useCallback(
    async (input: StartRunRequest) => {
      const run = await guarded((signal) => assistantApi.start(input, signal));
      if (run) dispatch({ type: 'run-updated', run });
    },
    [guarded],
  );

  const reply = useCallback(
    async (message: string) => {
      if (!activeId) return;
      const run = await guarded((signal) =>
        assistantApi.sendMessage(activeId, message, signal),
      );
      if (run) dispatch({ type: 'run-updated', run });
    },
    [activeId, guarded],
  );

  const cancel = useCallback(async () => {
    if (!activeId) return;
    const run = await guarded((signal) => assistantApi.cancel(activeId, signal));
    if (run) dispatch({ type: 'run-updated', run });
  }, [activeId, guarded]);

  // Serial polling of the active run: one request at a time, backing off on errors.
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
