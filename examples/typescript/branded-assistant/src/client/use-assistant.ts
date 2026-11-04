import { useEffect, useState } from 'react';
import { isTerminal, type ErrorBody, type RunView, type SessionView } from '@/shared/contracts';

const POLL_MS = 2_000;
const MAX_POLL_MS = 15_000;
const TIMEOUT_MS = 15_000;
const SOMETHING_WRONG = 'Something went wrong. Please try again.';
const UNREACHABLE = 'We could not reach the server. Please try again.';

/** A problem to show next to the part of the page it belongs to. */
export type AssistantNotice = { at: 'start' | 'run'; text: string };

/** An answer of this server that is not 2xx: its error code, HTTP status and text. */
export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

/** One call to this example's server, given up after 15 s. A lost connection rejects as is. */
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const json = body === undefined ? {} : { headers: { 'Content-Type': 'application/json' } };
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetch(path, { method, ...json, body: JSON.stringify(body), signal });
  const data: unknown = await response.json().catch(() => null);
  if (response.ok) return data as T;
  const { error = 'unknown', message } = (data ?? {}) as Partial<ErrorBody>;
  throw new ApiError(error, response.status, message || SOMETHING_WRONG);
}

/** This server's own text; a lost connection or a timeout reads as unreachable. */
const textOf = (error: unknown) => (error instanceof ApiError ? error.message : UNREACHABLE);

/**
 * After a failed start, the re-read session tells whether a run started anyway (a timed-out
 * request may still have reached the server). That run is adopted; otherwise the error shows.
 */
export function afterFailedStart(
  fresh: SessionView | undefined,
  error: unknown,
): AssistantNotice | undefined {
  if (fresh?.run && !isTerminal(fresh.run.status)) return undefined;
  return { at: 'start', text: textOf(error) };
}

export function useAssistant() {
  const [session, setSession] = useState<SessionView>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<AssistantNotice>();
  const [pollFailing, setPollFailing] = useState(false);

  /** A new run replaces the one on the page. */
  const showNewRun = (run: RunView) => {
    setSession((now) => now && { ...now, run, balance: run.balance });
  };
  /** A late answer about a run that is no longer on the page is dropped. */
  const updateRun = (run: RunView) => {
    setSession((now) => (now?.run?.id === run.id ? { ...now, run, balance: run.balance } : now));
  };
  const load = () =>
    api<SessionView>('GET', '/api/session').then(setSession, () => setLoadFailed(true));
  useEffect(() => void load(), []);

  const run = session?.run;
  const activeId = run && !isTerminal(run.status) ? run.id : undefined;
  // Serial polling of the active run, backing off while it fails, with a quiet notice until it
  // recovers. The server answers from what its own watcher recorded, so polling never reaches
  // the backend.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let delay = POLL_MS;
    let timer = setTimeout(async function poll() {
      const next = await api<RunView>('GET', `/api/runs/${activeId}`).catch(() => undefined);
      if (cancelled) return;
      if (next) updateRun(next);
      setPollFailing(!next);
      delay = next ? POLL_MS : Math.min(delay * 2, MAX_POLL_MS);
      timer = setTimeout(poll, delay);
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setPollFailing(false);
    };
  }, [activeId]);

  /** One action on the active run; false, with a notice, when it failed. */
  const act = async (path: string, body?: unknown) => {
    try {
      updateRun(await api<RunView>('POST', `/api/runs/${activeId}/${path}`, body));
      setNotice(undefined);
      return true;
    } catch (error) {
      setNotice({ at: 'run', text: textOf(error) });
      return false;
    }
  };

  return {
    session,
    loadFailed,
    notice,
    pollFailing,
    reload: () => {
      setLoadFailed(false);
      void load();
    },
    /** False when the start failed; the caller keeps the user's text. */
    async start(presetId: string, message: string) {
      setNotice(undefined);
      try {
        showNewRun(await api<RunView>('POST', '/api/runs', { presetId, message }));
        return true;
      } catch (error) {
        const fresh = await api<SessionView>('GET', '/api/session').catch(() => undefined);
        if (fresh) setSession(fresh);
        setNotice(afterFailedStart(fresh, error));
        return false;
      }
    },
    sendNote: (message: string) => act('messages', { message }),
    stop: () => act('cancel'),
  };
}
