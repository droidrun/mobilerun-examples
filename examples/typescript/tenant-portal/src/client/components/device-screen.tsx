import {
  DeviceStream,
  NavigationBar,
  StreamStatusPill,
} from '@mobilerun/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import type { StreamCredentials } from '@/shared/contracts';
import { ApiClientError, errorMessage, portalApi } from '../api-client';
import { stateLabel } from '../state-label';

type DeviceScreenProps = { state: string };

const RETRY_MS = 1_500;
const MAX_RETRY_MS = 15_000;

/**
 * The live, controllable screen. The server decides whether the device can
 * stream: this asks for credentials whenever a device exists and retries with
 * backoff until the server hands them out.
 */
export function DeviceScreen({ state }: DeviceScreenProps) {
  const streamRef = useRef<ComponentRef<typeof DeviceStream>>(null);
  const [credentials, setCredentials] = useState<StreamCredentials | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [hasControl, setHasControl] = useState(true);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let delay = RETRY_MS;
    setCredentials(null);
    setConnected(false);

    const attempt = async () => {
      try {
        const next = await portalApi.stream(controller.signal);
        if (controller.signal.aborted) return;
        setCredentials(next);
        setProblem(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        // 409 means "not streaming yet": show the device state instead.
        const notYet = error instanceof ApiClientError && error.status === 409;
        setProblem(notYet ? null : errorMessage(error));
        timer = window.setTimeout(attempt, delay);
        delay = Math.min(delay * 2, MAX_RETRY_MS);
      }
    };

    void attempt();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [state]);

  // The stream asks for fresh credentials after it dropped and reconnected.
  const refreshCredentials = useCallback(() => {
    portalApi.stream().then(setCredentials, () => undefined);
  }, []);

  return (
    <div className="screen">
      <div className="screen-frame">
        {credentials ? (
          <DeviceStream
            ref={streamRef}
            streamUrl={credentials.streamUrl}
            streamToken={credentials.streamToken}
            hasControl={hasControl}
            onHasControlChange={setHasControl}
            onConnectionStateChange={setConnected}
            onStreamHealed={refreshCredentials}
            placeholderLabel={stateLabel(state)}
            muted
          />
        ) : (
          <div className="screen-idle">
            <StreamStatusPill label={problem ?? stateLabel(state)} />
          </div>
        )}
      </div>
      <NavigationBar
        className="screen-nav"
        onAction={(key) => {
          if (connected && hasControl) streamRef.current?.sendSystemKey(key);
        }}
      />
    </div>
  );
}
