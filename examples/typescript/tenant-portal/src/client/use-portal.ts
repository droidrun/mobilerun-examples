import { useEffect, useState } from 'react';
import type { DeviceAction, DeviceView, ErrorBody, Me, StreamView } from '@/shared/contracts';

/** States that settle by themselves, so polling can pause. */
const SETTLED = ['ready', 'stopped', 'maintenance'];
const SOMETHING_WRONG = 'Something went wrong. Please try again.';

type Failure = Error & { status?: number };
const is = (error: unknown, status: number) => (error as Failure | null)?.status === status;
/** The server's own text, or the API's 4xx text it passed on. A network error stays plain. */
const messageOf = (error: unknown) =>
  (error as Failure | null)?.status ? (error as Failure).message : SOMETHING_WRONG;

async function api<T>(method: string, path: string, body?: unknown, signal?: AbortSignal) {
  const json = body === undefined ? {} : { headers: { 'Content-Type': 'application/json' } };
  const response = await fetch(path, { method, signal, ...json, body: JSON.stringify(body) });
  const data: unknown = await response.json().catch(() => null);
  if (response.ok) return data as T;
  const message = (data as ErrorBody | null)?.message || SOMETHING_WRONG;
  throw Object.assign(new Error(message), { status: response.status });
}

/**
 * Runs `attempt` one call at a time, each scheduled only after the last one finished:
 * 'again' waits `base` ms, 'retry' doubles the wait (at least `base`, at most `max`).
 */
function serially(
  [base, max]: [number, number],
  attempt: (signal: AbortSignal) => Promise<'again' | 'retry' | 'done'>,
  start = base,
) {
  const controller = new AbortController();
  let wait = start;
  let timer = setTimeout(async function tick() {
    const next = await attempt(controller.signal);
    if (next === 'done' || controller.signal.aborted) return;
    wait = next === 'again' ? base : Math.min(Math.max(base, wait * 2), max);
    timer = setTimeout(tick, wait);
  }, start);
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}

export function usePortal() {
  const [email, setEmail] = useState<string | null>(); // undefined: still checking
  const [device, setDevice] = useState<DeviceView | null>(); // undefined: not loaded yet
  const [deleted, setDeleted] = useState(false);
  const [stream, setStream] = useState<StreamView>();
  const [streamProblem, setStreamProblem] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [notice, setNotice] = useState<string>();

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
    const fail = (error: unknown) => (is(error, 401) ? signedOut() : setNotice(messageOf(error)));

    /** False only when the request failed; a 404 is an answer: no phone. */
    const refresh = async (signal?: AbortSignal) => {
      const mine = ++serial;
      try {
        const next = await api<DeviceView>('GET', '/api/device', undefined, signal);
        if (mine === serial) setDevice(next);
        return true;
      } catch (error) {
        if (signal?.aborted || mine !== serial) return true;
        const none = is(error, 404);
        // A failed first load still shows a screen, with the notice.
        setDevice((now) => (none || now === undefined ? null : now));
        if (!none) fail(error);
        return none;
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
      /** The stream is reconnecting: its credentials may have changed. */
      refreshStream: () => api<StreamView>('GET', '/api/device/stream').then(setStream, () => {}),
    };
  });

  useEffect(() => {
    const controller = new AbortController();
    api<Me>('GET', '/api/me', undefined, controller.signal).then(
      (me) => setEmail(me.email),
      () => controller.signal.aborted || setEmail(null),
    );
    return () => controller.abort();
  }, []);

  // Load the phone, then poll while it moves between states. Polls run one at a time, the
  // next after every attempt, failed or not, and back off while they fail.
  const state = device?.state;
  const noDevice = device === null;
  useEffect(() => {
    if (!email || noDevice || (state && SETTLED.includes(state))) return;
    return serially(
      [4_000, 30_000],
      async (signal) => ((await actions.refresh(signal)) ? 'again' : 'retry'),
      state ? 4_000 : 0,
    );
  }, [email, noDevice, state, actions]);

  // The server decides whether the phone can stream. Ask on every state change and retry with
  // backoff until it hands out credentials; 409 means "not streaming (yet)".
  useEffect(() => {
    setStreamProblem(undefined);
    if (!email || !state) {
      setStream(undefined);
      return;
    }
    return serially(
      [1_500, 15_000],
      async (signal) => {
        try {
          setStream(await api<StreamView>('GET', '/api/device/stream', undefined, signal));
          setStreamProblem(undefined);
          return 'done';
        } catch (error) {
          if (is(error, 409)) setStream(undefined);
          if (!signal.aborted) setStreamProblem(is(error, 409) ? undefined : messageOf(error));
          return 'retry';
        }
      },
      0,
    );
  }, [email, state]);

  return { email, device, deleted, stream, streamProblem, pending, notice, ...actions };
}

export type Portal = ReturnType<typeof usePortal>;
