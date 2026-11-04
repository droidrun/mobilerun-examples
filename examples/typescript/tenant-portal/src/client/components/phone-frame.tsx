// Shared with the other white-label examples in this folder.
import { DeviceStream, NavigationBar } from '@mobilerun/react';
import { useRef, useState, type ComponentRef } from 'react';
import { BrandMark, type Tone } from './app-shell';
import '@mobilerun/react/styles.css';
import './phone-frame.css';

type PhoneFrameProps = {
  /** Stream credentials from your server. Without them the screen shows `line`. */
  stream?: { streamUrl: string; streamToken?: string };
  /** Text and tone of the pill above the frame. */
  pill: string;
  tone: Tone;
  /** One line on the empty screen. */
  line: string;
  /** Whether the user may touch the phone right now. */
  hasControl: boolean;
  /** The stream is reconnecting: fetch fresh credentials if you can. */
  onStreamHealed?: () => void;
};

export function PhoneFrame(props: PhoneFrameProps) {
  const { stream, pill, tone, line, hasControl, onStreamHealed } = props;
  const streamRef = useRef<ComponentRef<typeof DeviceStream>>(null);
  const [connected, setConnected] = useState(false);
  // The empty screen covers the stream until its first picture, so the user
  // sees one designed state instead of the player's own placeholder.
  const [shownUrl, setShownUrl] = useState<string>();
  const onScreen = stream !== undefined && shownUrl === stream.streamUrl;
  const canNavigate = onScreen && connected && hasControl;

  return (
    <figure className="phone-frame">
      <figcaption className="pill" data-tone={tone}>
        {pill}
      </figcaption>
      <div className="phone">
        <div className="phone-screen">
          {stream ? (
            <DeviceStream
              ref={streamRef}
              streamUrl={stream.streamUrl}
              streamToken={stream.streamToken}
              hasControl={hasControl}
              muted
              onConnectionStateChange={(isConnected) => {
                setConnected(isConnected);
                if (isConnected) setShownUrl(stream.streamUrl);
              }}
              onStreamHealed={onStreamHealed}
            />
          ) : null}
          {onScreen ? null : (
            <div className="phone-empty">
              <BrandMark size={40} />
              <p>{line}</p>
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
