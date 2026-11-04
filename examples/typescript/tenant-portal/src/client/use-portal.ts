import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceView, Session } from '@/shared/contracts';
import { ApiClientError, portalApi } from './api-client';
import { isSettled } from './state-label';

type DeviceAction = 'stop' | 'resume' | 'reboot' | 'reset';

const POLL_MS = 4_000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

  const refreshDevice = useCallback(
    async (signal?: AbortSignal) => {
      const serial = ++requestSerial.current;
      try {
        const next = await portalApi.getDevice(signal);
        if (serial === requestSerial.current) setDevice(next);
      } catch (caught) {
        if (signal?.aborted || serial !== requestSerial.current) return;
        if (caught instanceof ApiClientError && caught.status === 401) {
          signedOut();
          return;
        }
        if (caught instanceof ApiClientError && caught.status === 404) {
          setDevice(null);
        } else {
          setError(messageOf(caught));
        }
      } finally {
        if (serial === requestSerial.current) setDeviceLoaded(true);
      }
    },
    [signedOut],
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

  // Poll serially while the device moves between states.
  const deviceState = device?.state;
  useEffect(() => {
    if (!userEmail || !deviceState || isSettled(deviceState)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void refreshDevice(controller.signal);
    }, POLL_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [userEmail, deviceState, device, refreshDevice]);

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await work();
      } catch (caught) {
        if (caught instanceof ApiClientError && caught.status === 401) {
          signedOut();
        } else {
          setError(messageOf(caught));
        }
      } finally {
        setBusy(false);
      }
    },
    [signedOut],
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
