import { useEffect, useState } from 'react';
import type { ErrorBody, SessionView, StreamView } from '@/shared/contracts';

export type Notice = { tone: 'warn' | 'danger'; text: string };
export type Demo =
  | { phase: 'idle'; notice?: Notice }
  | { phase: 'starting'; since: number }
  | { phase: 'live' | 'ending'; id: string; deadline: number; stream?: StreamView; notice?: Notice }
  | { phase: 'ended'; expired: boolean };

export class RequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function api<T>(method: string, path: string): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin' });
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body as T;
  const error = body as Partial<ErrorBody> | null;
  throw new RequestError(error?.error ?? 'unknown', error?.message ?? '');
}

const SOMETHING_WRONG: Notice = { tone: 'danger', text: 'Something went wrong. Please try again.' };
const OWN_LIMITS = ['capacity_reached', 'rate_limited'];

/** Only this server's own "not now" answers are shown as sent; anything else is one plain line. */
export function startNotice(error: unknown): Notice {
  return error instanceof RequestError && OWN_LIMITS.includes(error.code)
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

  const [actions] = useState(() => {
    const loadStream = async (id: string) => {
      const stream = await api<StreamView>('GET', `/api/sessions/${id}/stream`);
      setDemo((now) => ('id' in now && now.id === id ? { ...now, stream } : now));
    };

    return {
      async start() {
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
      },
      async end(id: string) {
        setDemo((now) =>
          now.phase === 'live' ? { ...now, phase: 'ending', notice: undefined } : now,
        );
        const ended = await api('DELETE', `/api/sessions/${id}`).then(() => true, () => false);
        setDemo((now) => {
          if (now.phase !== 'ending') return now;
          if (ended) return { phase: 'ended', expired: false };
          // The phone is still running, so the demo stays on screen.
          return { ...now, phase: 'live', notice: SOMETHING_WRONG };
        });
      },
      /** The stream is reconnecting: its credentials may have changed. */
      refreshStream: (id: string) => void loadStream(id).catch(() => {}),
      reset: () => setDemo({ phase: 'idle' }),
    };
  });

  return { demo, ...actions };
}
