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

export function useAssistant() {
  const [session, setSession] = useState<SessionView>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<AssistantNotice>();
  const setRun = (run: RunView) => {
    setSession((now) => now && { ...now, run, balance: run.balance });
  };
  const load = () =>
    api<SessionView>('GET', '/api/session').then(setSession, () => setLoadFailed(true));
  useEffect(() => void load(), []);

  const run = session?.run;
  const activeId = run && !isTerminal(run.status) ? run.id : undefined;
  // Serial polling of the active run, backing off while it fails. The server answers from what
  // its own watcher recorded, so polling never reaches the backend.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let delay = POLL_MS;
    let timer = setTimeout(async function poll() {
      const next = await api<RunView>('GET', `/api/runs/${activeId}`).catch(() => undefined);
      if (cancelled) return;
      if (next) setRun(next);
      delay = next ? POLL_MS : Math.min(delay * 2, MAX_POLL_MS);
      timer = setTimeout(poll, delay);
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeId]);

  /** One action on the active run; false, with a notice, when it failed. */
  const act = async (path: string, body?: unknown) => {
    try {
      setRun(await api<RunView>('POST', `/api/runs/${activeId}/${path}`, body));
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
    reload: () => {
      setLoadFailed(false);
      void load();
    },
    /** False when the start failed; the caller keeps the user's text. */
    async start(presetId: string, message: string) {
      setNotice(undefined);
      try {
        setRun(await api<RunView>('POST', '/api/runs', { presetId, message }));
        return true;
      } catch (error) {
        const fresh = await api<SessionView>('GET', '/api/session').catch(() => undefined);
        if (fresh) setSession(fresh);
        // A timed-out start may still have started a run: look before offering another.
        if (!fresh?.run || isTerminal(fresh.run.status)) {
          setNotice({ at: 'start', text: textOf(error) });
        }
        return false;
      }
    },
    sendNote: (message: string) => act('messages', { message }),
    stop: () => act('cancel'),
  };
}
