import { useEffect, useState } from 'react';
import type { DeviceAction, DeviceView, ErrorBody, Me, StreamView } from '@/shared/contracts';

/** States that settle by themselves, so polling can pause. */
const SETTLED = ['ready', 'stopped', 'maintenance'];
/** Device polls: every 4 s, backing off to 30 s while they fail. */
const POLL = { every: 4_000, max: 30_000 };
/** Stream credentials: asked again from 1.5 s, backing off to 15 s, until the server has them. */
const STREAM_RETRY = { every: 1_500, max: 15_000 };
const SOMETHING_WRONG = 'Something went wrong. Please try again.';

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

/** The server's own text, or the API's 4xx text it passed on. A lost connection stays plain. */
const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : SOMETHING_WRONG);
const hasStatus = (error: unknown, status: number) =>
  error instanceof ApiError && error.status === status;

/**
 * Runs `attempt` one call at a time, each scheduled only after the last one finished:
 * 'again' waits `every` ms, 'retry' doubles the wait (at most `max`), 'done' stops. The returned
 * function cancels; an attempt still running then sees `cancelled()` and should drop its answer.
 */
function serially(
  { every, max }: { every: number; max: number },
  attempt: (cancelled: () => boolean) => Promise<'again' | 'retry' | 'done'>,
  firstIn = every,
) {
  let cancelled = false;
  let wait = firstIn;
  let timer = setTimeout(async function tick() {
    const next = await attempt(() => cancelled);
    if (next === 'done' || cancelled) return;
    wait = next === 'again' ? every : Math.min(Math.max(every, wait * 2), max);
    timer = setTimeout(tick, wait);
  }, firstIn);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

/** What the phone screen shows: a stream, or why there is none. */
type Screen = { stream: StreamView; problem?: never } | { problem: string; stream?: never };

export function usePortal() {
  const [email, setEmail] = useState<string | null>(); // undefined: still checking
  const [device, setDevice] = useState<DeviceView | null>(); // undefined: not loaded yet
  const [deleted, setDeleted] = useState(false);
  const [screen, setScreen] = useState<Screen>();
  const [healed, setHealed] = useState(0); // counts stream reconnects; each asks again
  const [pending, setPending] = useState<string>();
  const [notice, setNotice] = useState<string>();

  // Created once: `serial` must outlive renders, and the poll below depends on `actions`.
  const [actions] = useState(() => {
    let serial = 0; // a newer device request or a sign-out makes older answers stale
    const showDevice = (next: DeviceView | null | undefined) => {
      serial += 1;
      setDevice(next);
    };
    const signedOut = () => {
      setEmail(null);
      setDeleted(false);
      showDevice(undefined);
    };
    // An ended session goes back to sign-in; anything else shows as a notice.
    const fail = (error: unknown) => {
      if (hasStatus(error, 401)) signedOut();
      else setNotice(messageOf(error));
    };

    /** A 404 is an answer (no phone); 'failed' means the request itself failed. */
    const refresh = async (): Promise<'ok' | 'failed'> => {
      const mine = ++serial;
      try {
        const next = await api<DeviceView>('GET', '/api/device');
        if (mine === serial) setDevice(next);
        return 'ok';
      } catch (error) {
        if (mine !== serial) return 'ok';
        if (hasStatus(error, 404)) {
          setDevice(null);
          return 'ok';
        }
        fail(error);
        return 'failed';
      }
    };

    const run = async (key: string, work: () => Promise<unknown>) => {
      setPending(key);
      setNotice(undefined);
      await work().catch(fail);
      setPending(undefined);
    };

    return {
      refresh,
      signIn: (address: string) =>
        run('sign-in', async () => {
          setEmail((await api<Me>('POST', '/api/login', { email: address })).email);
        }),
      signOut: () => run('sign-out', () => api('POST', '/api/logout').then(signedOut)),
      create: () =>
        run('create', async () => {
          showDevice(await api<DeviceView>('POST', '/api/device'));
          setDeleted(false);
        }),
      act: (action: DeviceAction) =>
        run(action, async () => {
          await api('POST', `/api/device/${action}`);
          await refresh();
        }),
      remove: () =>
        run('delete', async () => {
          await api('DELETE', '/api/device');
          showDevice(null);
          setDeleted(true);
        }),
    };
  });

  useEffect(() => {
    let cancelled = false;
    api<Me>('GET', '/api/me').then(
      (me) => cancelled || setEmail(me.email),
      () => cancelled || setEmail(null),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the phone, then poll while it moves between states. Polls run one at a time, the
  // next after every attempt, failed or not, and back off while they fail; a failed first
  // load is retried the same way.
  const state = device?.state;
  const noDevice = device === null;
  useEffect(() => {
    if (!email || noDevice || (state && SETTLED.includes(state))) return;
    const poll = async () => ((await actions.refresh()) === 'ok' ? 'again' : 'retry');
    return serially(POLL, poll, state ? POLL.every : 0);
  }, [email, noDevice, state, actions]);

  // The server decides whether the phone can stream. Ask on every state change and after every
  // reconnect, and retry with backoff until it hands out credentials; 409 means "not streaming
  // (yet)". Signing out or a new state cancels the loop, so a late answer is dropped.
  useEffect(() => {
    if (!email || !state) {
      setScreen(undefined);
      return;
    }
    setScreen((now) => (now?.stream ? now : undefined));
    return serially(
      STREAM_RETRY,
      async (cancelled) => {
        try {
          const stream = await api<StreamView>('GET', '/api/device/stream');
          if (!cancelled()) setScreen({ stream });
          return 'done';
        } catch (error) {
          if (cancelled()) return 'done';
          // A working stream survives a failed refresh; a 409 means it is gone.
          const problem = messageOf(error);
          if (hasStatus(error, 409)) setScreen(undefined);
          else setScreen((now) => (now?.stream ? now : { problem }));
          return 'retry';
        }
      },
      0,
    );
  }, [email, state, healed]);

  return {
    email,
    device,
    deleted,
    stream: screen?.stream,
    streamProblem: screen?.problem,
    pending,
    notice,
    ...actions,
    /** The stream is reconnecting: its credentials may have changed. */
    refreshStream: () => setHealed((count) => count + 1),
  };
}

export type Portal = ReturnType<typeof usePortal>;
