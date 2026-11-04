import {
  DeviceStream,
  NavigationBar,
  StreamStatusPill,
} from '@mobilerun/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import type { StreamCredentials } from '@/shared/contracts';
import { portalApi } from '../api-client';
import { isStreamable, stateLabel } from '../state-label';

type DeviceScreenProps = { state: string };

/** The live, controllable screen. Stream credentials come from the portal server. */
export function DeviceScreen({ state }: DeviceScreenProps) {
  const streamRef = useRef<ComponentRef<typeof DeviceStream>>(null);
  const [credentials, setCredentials] = useState<StreamCredentials | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [hasControl, setHasControl] = useState(true);
  const [connected, setConnected] = useState(false);
  const streamable = isStreamable(state);

  const loadCredentials = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await portalApi.stream(signal);
      if (signal?.aborted) return;
      setCredentials(next);
      setProblem(null);
    } catch (error) {
      if (signal?.aborted) return;
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    if (!streamable) {
      setCredentials(null);
      setConnected(false);
      return;
    }
    const controller = new AbortController();
    void loadCredentials(controller.signal);
    return () => controller.abort();
  }, [streamable, loadCredentials]);

  const label = problem ?? stateLabel(state);

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
            onStreamHealed={() => void loadCredentials()}
            placeholderLabel={stateLabel(state)}
            muted
          />
        ) : (
          <div className="screen-idle">
            <StreamStatusPill label={label} />
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
