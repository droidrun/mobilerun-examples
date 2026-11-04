import { useCallback, useEffect, useReducer, useRef } from 'react';
import { demoApi } from './api-client';
import {
  INITIAL_DEMO_STATE,
  demoReducer,
  type DemoState,
} from './demo-machine';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useDemo() {
  const [state, dispatch] = useReducer(demoReducer, INITIAL_DEMO_STATE);
  const stateRef = useRef<DemoState>(state);
  stateRef.current = state;

  useEffect(() => {
    const controller = new AbortController();
    demoApi
      .health(controller.signal)
      .then((health) =>
        dispatch({ type: 'configured', sdkConfigured: health.sdkConfigured }),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({ type: 'failed', message: messageOf(error) });
      });
    return () => controller.abort();
  }, []);

  // The server ends the demo at the same moment; the page just stops showing it.
  useEffect(() => {
    if (state.phase !== 'live' || state.deadline === undefined) return;
    const timer = setTimeout(
      () => dispatch({ type: 'expired' }),
      Math.max(0, state.deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [state.phase, state.deadline]);

  const start = useCallback(async () => {
    dispatch({ type: 'start' });
    let sessionId: string | undefined;
    try {
      const session = await demoApi.start();
      sessionId = session.id;
      dispatch({
        type: 'started',
        sessionId: session.id,
        deadline: Date.now() + session.expiresInSeconds * 1_000,
      });
      dispatch({ type: 'stream', stream: await demoApi.stream(session.id) });
    } catch (error) {
      if (sessionId) void demoApi.end(sessionId).catch(() => {});
      dispatch({ type: 'failed', message: messageOf(error) });
    }
  }, []);

  const end = useCallback(async () => {
    const sessionId = stateRef.current.sessionId;
    if (!sessionId) return;
    dispatch({ type: 'end' });
    try {
      await demoApi.end(sessionId);
      dispatch({ type: 'ended' });
    } catch (error) {
      dispatch({ type: 'failed', message: messageOf(error) });
    }
  }, []);

  /** Called when the stream reconnects: fetch fresh credentials. */
  const refreshStream = useCallback(() => {
    const sessionId = stateRef.current.sessionId;
    if (!sessionId) return;
    demoApi
      .stream(sessionId)
      .then((stream) => dispatch({ type: 'stream', stream }))
      .catch(() => {});
  }, []);

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  return { state, start, end, refreshStream, reset };
}
