import { useEffect, useState } from 'react';
import { isTerminal, type ErrorBody, type RunView, type SessionView } from '@/shared/contracts';

const POLL_MS = 2_000;
const MAX_POLL_MS = 15_000;
const TIMEOUT_MS = 15_000;
const UNREACHABLE = 'We could not reach the server. Please try again.';

/** A problem to show next to the part of the page it belongs to. */
export type Notice = { at: 'start' | 'run'; text: string };

/** One call to this example's server. Its own error text is shown; a lost connection is not. */
async function api<T>(path: string, body?: unknown): Promise<T> {
  const post = body !== undefined;
  const response = await fetch(path, {
    method: post ? 'POST' : 'GET',
    headers: post ? { 'Content-Type': 'application/json' } : undefined,
    body: post ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => Promise.reject(new Error(UNREACHABLE)));
  const data: unknown = await response.json().catch(() => null);
  if (response.ok) return data as T;
  throw new Error((data as Partial<ErrorBody> | null)?.message || UNREACHABLE);
}
const textOf = (error: unknown) => (error instanceof Error ? error.message : UNREACHABLE);

export function useAssistant() {
  const [session, setSession] = useState<SessionView>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const setRun = (run: RunView) =>
    setSession((now) => now && { ...now, run, balance: run.balance });
  const load = () =>
    api<SessionView>('/api/session').then(setSession, () => setLoadFailed(true));
  useEffect(() => void load(), []);

  const run = session?.run;
  const activeId = run && !isTerminal(run.status) ? run.id : undefined;
  // Serial polling of the active run, backing off on errors. The server answers from what
  // its own watcher recorded, so polling never reaches the backend.
  useEffect(() => {
    if (!activeId) return;
    let delay = POLL_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const next = await api<RunView>(`/api/runs/${activeId}`).catch(() => undefined);
      if (!timer) return; // stopped meanwhile
      if (next) setRun(next);
      delay = next ? POLL_MS : Math.min(delay * 2, MAX_POLL_MS);
      timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, delay);
    return () => {
      clearTimeout(timer);
      timer = undefined;
    };
  }, [activeId]);

  /** One action on the active run; false, with a notice, when it failed. */
  const act = (path: string, body: unknown) =>
    api<RunView>(`/api/runs/${activeId}/${path}`, body).then(
      (next) => (setRun(next), setNotice(undefined), true),
      (error: unknown) => (setNotice({ at: 'run', text: textOf(error) }), false),
    );

  return {
    session,
    loadFailed,
    notice,
    reload: () => (setLoadFailed(false), load()),
    /** False when the start failed; the caller keeps the user's text. */
    async start(presetId: string, message: string) {
      setNotice(undefined);
      try {
        setRun(await api<RunView>('/api/runs', { presetId, message }));
        return true;
      } catch (error) {
        // A timed-out start may still have started a run: look before offering another.
        const fresh = await api<SessionView>('/api/session').catch(() => undefined);
        if (fresh) setSession(fresh);
        if (!fresh?.run || isTerminal(fresh.run.status)) {
          setNotice({ at: 'start', text: textOf(error) });
        }
        return false;
      }
    },
    sendNote: (message: string) => act('messages', { message }),
    stop: () => act('cancel', {}),
  };
}
