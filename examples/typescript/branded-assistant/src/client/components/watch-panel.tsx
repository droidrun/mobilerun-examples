import { DeviceStream } from '@mobilerun/react';
import { useState } from 'react';

type WatchPanelProps = {
  streamUrl: string | undefined;
  streamToken: string | undefined;
};

/**
 * Optional "watch" panel. The viewer is read-only here (`hasControl={false}`),
 * but note that is a UI choice: see the README before relying on it.
 */
export function WatchPanel({ streamUrl, streamToken }: WatchPanelProps) {
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  if (!streamUrl || !streamToken) return null;

  return (
    <div className="watch">
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide the phone' : 'Watch it happen'}
      </button>
      {open ? (
        <div className="watch-screen">
          <DeviceStream
            streamUrl={streamUrl}
            streamToken={streamToken}
            hasControl={false}
            onConnectionStateChange={setConnected}
            placeholderLabel={connected ? 'Live' : 'Connecting'}
            muted
          />
        </div>
      ) : null}
    </div>
  );
}
