import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { RunTaskRequest } from '@/shared/contracts';
import { taskRunnerApi } from './api-client';
import {
  createInitialRunnerState,
  runnerReducer,
} from './runner-machine';

const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_POLL_INTERVAL_MS = 15_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function requestSignal(parent: AbortSignal): AbortSignal {
  return AbortSignal.any([
    parent,
    AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  ]);
}

export function useTaskRunner() {
  const [state, dispatch] = useReducer(
    runnerReducer,
    undefined,
    createInitialRunnerState,
  );
  const startController = useRef<AbortController | null>(null);
  const cancelController = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    startController.current?.abort();
    cancelController.current?.abort();
    startController.current = null;
    cancelController.current = null;
    dispatch({ type: 'reset' });
  }, []);

  const run = useCallback(async (input: RunTaskRequest) => {
    startController.current?.abort();
    const controller = new AbortController();
    startController.current = controller;
    dispatch({ type: 'start-requested' });

    try {
      const started = await taskRunnerApi.start(
        input,
        requestSignal(controller.signal),
      );
      if (!controller.signal.aborted) {
        dispatch({ type: 'start-succeeded', run: started });
      }
    } catch (error) {
      if (!isAbortError(error)) {
        dispatch({ type: 'start-failed', message: errorMessage(error) });
      }
    } finally {
      if (startController.current === controller) {
        startController.current = null;
      }
    }
  }, []);

  const cancel = useCallback(async () => {
    if (!state.runId || state.phase !== 'active') return;
    cancelController.current?.abort();
    const controller = new AbortController();
    cancelController.current = controller;
    dispatch({ type: 'cancel-requested' });
    try {
      await taskRunnerApi.cancel(state.runId, controller.signal);
    } catch (error) {
      if (!isAbortError(error)) {
        dispatch({ type: 'cancel-failed', message: errorMessage(error) });
      }
    } finally {
      if (cancelController.current === controller) {
        cancelController.current = null;
      }
    }
  }, [state.phase, state.runId]);

  useEffect(
    () => () => {
      startController.current?.abort();
      cancelController.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!state.runId || !['active', 'cancelling'].includes(state.phase)) return;

    const controller = new AbortController();
    let timer: number | undefined;
    let pollInterval = POLL_INTERVAL_MS;

    const poll = async () => {
      try {
        const task = await taskRunnerApi.retrieve(
          state.runId as string,
          requestSignal(controller.signal),
        );
        if (!controller.signal.aborted) {
          pollInterval = POLL_INTERVAL_MS;
          dispatch({ type: 'poll-succeeded', task });
        }
      } catch (error) {
        if (!isAbortError(error)) {
          pollInterval = Math.min(pollInterval * 2, MAX_POLL_INTERVAL_MS);
          dispatch({ type: 'poll-failed', message: errorMessage(error) });
        }
      } finally {
        if (!controller.signal.aborted) {
          timer = window.setTimeout(poll, pollInterval);
        }
      }
    };

    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [state.phase, state.runId]);

  return { state, run, cancel, reset };
}
