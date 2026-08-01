import { DeviceStream } from '@mobilerun/react';
import { useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import type { RunnerState } from '@/client/runner-machine';
import { statusLabel } from '@/client/status-label';
import { DeviceNavigation } from './device-navigation';

type DevicePanelProps = {
  state: RunnerState;
};

export function DevicePanel({ state }: DevicePanelProps) {
  const deviceStreamRef = useRef<ComponentRef<typeof DeviceStream>>(null);
  const [hasControl, setHasControl] = useState(false);
  const [connected, setConnected] = useState(false);
  const navigationEnabled = connected && hasControl;

  useEffect(() => {
    setConnected(false);
    setHasControl(false);
  }, [state.runId]);

  const sendSystemKey = (keycode: 'BACK' | 'HOME' | 'RECENT') => {
    if (navigationEnabled) {
      deviceStreamRef.current?.sendSystemKey(keycode);
    }
  };

  return (
    <div className="device-column">
      <div className="panel-label">
        <span>LIVE DEVICE</span>
        <span className={connected ? 'signal connected' : 'signal'}>
          {connected ? 'CONNECTED' : 'STANDBY'}
        </span>
      </div>

      <div className="device-frame">
        <div className="device-screen">
          <DeviceStream
            ref={deviceStreamRef}
            streamUrl={state.streamUrl}
            streamToken={state.streamToken}
            hasControl={hasControl}
            onHasControlChange={setHasControl}
            onConnectionStateChange={setConnected}
            placeholderLabel={statusLabel(state, connected)}
            muted
          />
        </div>
        <DeviceNavigation
          disabled={!navigationEnabled}
          onAction={sendSystemKey}
        />
      </div>

      <label className="control-switch">
        <span>
          <strong>Manual control</strong>
          <small>Take over touch and keyboard input</small>
        </span>
        <input
          type="checkbox"
          checked={hasControl}
          disabled={!state.streamUrl}
          onChange={(event) => setHasControl(event.target.checked)}
        />
        <span className="switch-track" aria-hidden="true" />
      </label>
    </div>
  );
}
