import { DeviceStream, NavigationBar, StreamStatusPill } from '@mobilerun/react';
import { useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { isLive, type DemoState } from '@/client/demo-machine';

type PhoneFrameProps = {
  state: DemoState;
  logoSrc: string | null;
  onStreamHealed: () => void;
};

function placeholder(state: DemoState): string | null {
  switch (state.phase) {
    case 'starting':
      return 'Starting your demo…';
    default:
      return isLive(state) && !state.streamUrl ? 'Connecting…' : null;
  }
}

export function PhoneFrame({ state, logoSrc, onStreamHealed }: PhoneFrameProps) {
  const streamRef = useRef<ComponentRef<typeof DeviceStream>>(null);
  const [connected, setConnected] = useState(false);
  const showStream = isLive(state) && state.streamUrl;
  const pending = placeholder(state);

  return (
    <div className="phone" aria-live="polite">
      <div className="phone-screen">
        {showStream ? (
          <DeviceStream
            ref={streamRef}
            streamUrl={state.streamUrl}
            streamToken={state.streamToken}
            hasControl
            onConnectionStateChange={setConnected}
            onStreamHealed={onStreamHealed}
            placeholderLabel="Connecting…"
            muted
          />
        ) : (
          <div className="phone-idle">
            {logoSrc ? <img src={logoSrc} alt="" width="64" height="64" /> : null}
            {pending ? <StreamStatusPill label={pending} /> : null}
          </div>
        )}
      </div>
      <NavigationBar
        className={connected && showStream ? 'phone-nav' : 'phone-nav phone-nav-off'}
        onAction={(key) => {
          if (connected) streamRef.current?.sendSystemKey(key);
        }}
      />
    </div>
  );
}
