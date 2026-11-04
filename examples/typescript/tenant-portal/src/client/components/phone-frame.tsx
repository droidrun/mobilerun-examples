// Shared by the white-label examples (try-our-app, tenant-portal, branded-assistant). Keep identical.
import { DeviceStream, NavigationBar } from '@mobilerun/react';
import { useRef, useState, type ComponentRef } from 'react';
import { BrandMark } from './app-shell';

export type Tone = 'neutral' | 'busy' | 'live' | 'danger';

type PhoneFrameProps = {
  /** Stream credentials from your server. Without them the screen shows `label`. */
  stream?: { url: string; token?: string };
  /** One line on the empty screen. */
  label: string;
  /** Whether the visitor may touch the phone right now. */
  hasControl: boolean;
  /** Text of the pill above the frame. */
  status: string;
  tone?: Tone;
  /** The stream is reconnecting: fetch fresh credentials if you can. */
  onStreamHealed?: () => void;
};

export function PhoneFrame(props: PhoneFrameProps) {
  const { stream, label, hasControl, status, tone = 'neutral', onStreamHealed } = props;
  const streamRef = useRef<ComponentRef<typeof DeviceStream>>(null);
  const [connected, setConnected] = useState(false);
  // The empty screen covers the stream until its first picture, so the visitor
  // sees one designed state instead of the player's own placeholder.
  const [shownUrl, setShownUrl] = useState<string>();
  const onScreen = stream !== undefined && shownUrl === stream.url;
  const canNavigate = onScreen && connected && hasControl;

  return (
    <figure className="phone-frame">
      <figcaption className="pill" data-tone={tone}>
        {status}
      </figcaption>
      <div className="phone">
        <div className="phone-screen">
          {stream ? (
            <DeviceStream
              ref={streamRef}
              streamUrl={stream.url}
              streamToken={stream.token}
              hasControl={hasControl}
              muted
              onConnectionStateChange={(isConnected) => {
                setConnected(isConnected);
                if (isConnected) setShownUrl(stream.url);
              }}
              onStreamHealed={onStreamHealed}
            />
          ) : null}
          {onScreen ? null : (
            <div className="phone-empty">
              <BrandMark size={40} />
              <p>{label}</p>
            </div>
          )}
        </div>
        <NavigationBar
          className={canNavigate ? 'phone-nav' : 'phone-nav is-off'}
          onAction={(key) => canNavigate && streamRef.current?.sendSystemKey(key)}
        />
      </div>
    </figure>
  );
}
