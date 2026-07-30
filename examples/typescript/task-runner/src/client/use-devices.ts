import { useCallback, useEffect, useState } from 'react';
import type { DeviceSummary } from '@/shared/contracts';
import { taskRunnerApi } from './api-client';

type DevicesState = {
  items: Array<DeviceSummary>;
  loading: boolean;
  error: string | null;
};

const INITIAL_STATE: DevicesState = {
  items: [],
  loading: true,
  error: null,
};

export function useDevices() {
  const [state, setState] = useState<DevicesState>(INITIAL_STATE);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: null }));

    taskRunnerApi
      .listDevices(controller.signal)
      .then((items) => setState({ items, loading: false, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          items: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => controller.abort();
  }, [reloadKey]);

  return { ...state, reload };
}
