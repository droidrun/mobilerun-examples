import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceAction, DeviceView, Session } from '@/shared/contracts';
import {
  ApiClientError,
  errorMessage,
  isUnauthorized,
  portalApi,
} from './api-client';
import { isSettled } from './state-label';

const POLL_MS = 4_000;
const MAX_POLL_MS = 30_000;

export function usePortal() {
  const [booting, setBooting] = useState(true);
  const [sdkConfigured, setSdkConfigured] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [device, setDevice] = useState<DeviceView | null>(null);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSerial = useRef(0);

  const signedOut = useCallback(() => {
    requestSerial.current += 1;
    setSession(null);
    setDevice(null);
    setDeviceLoaded(false);
  }, []);

  // One place for failures: an expired session signs out, anything else shows.
  const fail = useCallback(
    (caught: unknown) => {
      if (isUnauthorized(caught)) signedOut();
      else setError(errorMessage(caught));
    },
    [signedOut],
  );

  /** Resolves true when the server answered, false when the request failed. */
  const refreshDevice = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      const serial = ++requestSerial.current;
      try {
        const next = await portalApi.getDevice(signal);
        if (serial === requestSerial.current) setDevice(next);
        return true;
      } catch (caught) {
        if (signal?.aborted || serial !== requestSerial.current) return true;
        if (caught instanceof ApiClientError && caught.status === 404) {
          setDevice(null);
          return true;
        }
        fail(caught);
        return false;
      } finally {
        if (serial === requestSerial.current) setDeviceLoaded(true);
      }
    },
    [fail],
  );

  useEffect(() => {
    const controller = new AbortController();
    portalApi
      .health(controller.signal)
      .then((health) => setSdkConfigured(health.sdkConfigured))
      .catch(() => undefined);
    portalApi
      .me(controller.signal)
      .then(setSession)
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setBooting(false);
      });
    return () => controller.abort();
  }, []);

  const userEmail = session?.email;
  useEffect(() => {
    if (!userEmail) return;
    const controller = new AbortController();
    void refreshDevice(controller.signal);
    return () => controller.abort();
  }, [userEmail, refreshDevice]);

  // While the device moves between states, poll serially: the next attempt is
  // scheduled after every attempt, failed or not, and backs off on failures.
  const deviceState = device?.state;
  useEffect(() => {
    if (!userEmail || !deviceState || isSettled(deviceState)) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let interval = POLL_MS;

    const poll = async () => {
      const answered = await refreshDevice(controller.signal);
      if (controller.signal.aborted) return;
      interval = answered ? POLL_MS : Math.min(interval * 2, MAX_POLL_MS);
      timer = window.setTimeout(poll, interval);
    };

    timer = window.setTimeout(poll, interval);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [userEmail, deviceState, refreshDevice]);

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await work();
      } catch (caught) {
        fail(caught);
      } finally {
        setBusy(false);
      }
    },
    [fail],
  );

  return {
    booting,
    sdkConfigured,
    session,
    device,
    deviceLoaded,
    busy,
    error,
    signIn: (email: string) =>
      run(async () => {
        setSession(await portalApi.login(email));
      }),
    signOut: () =>
      run(async () => {
        await portalApi.logout();
        signedOut();
      }),
    createDevice: () =>
      run(async () => {
        setDevice(await portalApi.createDevice());
      }),
    act: (action: DeviceAction) =>
      run(async () => {
        await portalApi.deviceAction(action);
        await refreshDevice();
      }),
    terminate: () =>
      run(async () => {
        await portalApi.terminateDevice();
        setDevice(null);
      }),
  };
}
