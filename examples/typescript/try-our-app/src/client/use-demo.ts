import { useEffect, useState } from 'react';
import type { ErrorBody, SessionView, StreamView } from '@/shared/contracts';
import type { Tone } from './components/app-shell';

export type DemoNotice = { tone: Tone; text: string };
type Session = { id: string; deadline: number; stream?: StreamView; notice?: DemoNotice };
export type Demo =
  | { phase: 'idle'; notice?: DemoNotice }
  | { phase: 'starting'; since: number }
  | ({ phase: 'live' | 'ending' } & Session)
  | { phase: 'ended'; expired: boolean };

const SOMETHING_WRONG = 'Something went wrong. Please try again.';
const OWN_LIMITS = ['capacity_reached', 'rate_limited'];

/** An answer of this server that is not 2xx: its error code, HTTP status and text. */
export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

/** One call to this example's server. A lost connection rejects with the browser's own error. */
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const json = body === undefined ? {} : { headers: { 'Content-Type': 'application/json' } };
  const response = await fetch(path, { method, ...json, body: JSON.stringify(body) });
  const data: unknown = await response.json().catch(() => null);
  if (response.ok) return data as T;
  const { error = 'unknown', message } = (data ?? {}) as Partial<ErrorBody>;
  throw new ApiError(error, response.status, message || SOMETHING_WRONG);
}

/** Only this server's own "not now" answers are shown as sent; anything else is one plain line. */
export function startNotice(error: unknown): DemoNotice {
  return error instanceof ApiError && OWN_LIMITS.includes(error.code)
    ? { tone: 'warn', text: error.message }
    : { tone: 'danger', text: 'We could not start the demo. Please try again.' };
}

export function useDemo() {
  const [demo, setDemo] = useState<Demo>({ phase: 'idle' });

  // The server ends the demo at the same moment; the page just stops showing it.
  const deadline = demo.phase === 'live' ? demo.deadline : undefined;
  useEffect(() => {
    if (deadline === undefined) return;
    const expire = () => setDemo({ phase: 'ended', expired: true });
    const timer = setTimeout(expire, deadline - Date.now());
    return () => clearTimeout(timer);
  }, [deadline]);

  async function loadStream(id: string) {
    const stream = await api<StreamView>('GET', `/api/sessions/${id}/stream`);
    setDemo((now) => ('id' in now && now.id === id ? { ...now, stream } : now));
  }

  async function start() {
    setDemo({ phase: 'starting', since: Date.now() });
    let session: SessionView | undefined;
    try {
      session = await api<SessionView>('POST', '/api/sessions');
      const deadline = Date.now() + session.expiresInSeconds * 1_000;
      setDemo({ phase: 'live', id: session.id, deadline });
      await loadStream(session.id);
    } catch (error) {
      if (session) api('DELETE', `/api/sessions/${session.id}`).catch(() => {});
      setDemo({ phase: 'idle', notice: startNotice(error) });
    }
  }

  async function end(id: string) {
    setDemo((now) => (now.phase === 'live' ? { ...now, phase: 'ending', notice: undefined } : now));
    const ended = await api('DELETE', `/api/sessions/${id}`).then(() => true, () => false);
    setDemo((now) => {
      if (now.phase !== 'ending') return now;
      if (ended) return { phase: 'ended', expired: false };
      // The phone is still running, so the demo stays on screen.
      return { ...now, phase: 'live', notice: { tone: 'danger', text: SOMETHING_WRONG } };
    });
  }

  return {
    demo,
    start,
    end,
    /** The stream is reconnecting: its credentials may have changed. */
    refreshStream: (id: string) => void loadStream(id).catch(() => {}),
    reset: () => setDemo({ phase: 'idle' }),
  };
}
