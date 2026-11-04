import { useState } from 'react';
import type { DeviceAction, DeviceView } from '@/shared/contracts';
import { stateLabel } from '../state-label';
import { DeviceScreen } from './device-screen';

type DeviceCardProps = {
  device: DeviceView;
  busy: boolean;
  onAction: (action: DeviceAction) => void;
  onTerminate: () => void;
};

type Confirmation = 'reset' | 'terminate';

const CONFIRM_COPY: Record<Confirmation, { question: string; confirm: string }> = {
  reset: {
    question: 'Reset your phone? Apps, accounts and files will be erased.',
    confirm: 'Yes, reset',
  },
  terminate: {
    question: 'Delete your phone? This cannot be undone.',
    confirm: 'Yes, delete',
  },
};

export function DeviceCard({
  device,
  busy,
  onAction,
  onTerminate,
}: DeviceCardProps) {
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const stopped = device.state === 'stopped';

  const confirm = () => {
    const pending = confirming;
    setConfirming(null);
    if (pending === 'reset') onAction('reset');
    if (pending === 'terminate') onTerminate();
  };

  const buttons = [
    stopped
      ? { label: 'Start', className: 'primary', onClick: () => onAction('resume') }
      : { label: 'Stop', className: '', onClick: () => onAction('stop') },
    { label: 'Restart', className: '', onClick: () => onAction('reboot') },
    { label: 'Reset', className: '', onClick: () => setConfirming('reset') },
    { label: 'Delete', className: 'danger', onClick: () => setConfirming('terminate') },
  ];

  return (
    <section className="card device-card" aria-label="Your phone">
      <div className="device-layout">
        <DeviceScreen state={device.state} />

        <div className="device-side">
          <div className="device-head">
            <h2>Your phone</h2>
            <span className={`badge state-${device.state}`}>
              {stateLabel(device.state)}
            </span>
          </div>
          {device.stateMessage ? (
            <p className="muted">{device.stateMessage}</p>
          ) : null}
          <p className="muted">
            Created {new Date(device.createdAt).toLocaleString()}
          </p>

          <div className="actions">
            {buttons.map(({ label, className, onClick }) => (
              <button
                key={label}
                className={`button ${className}`}
                type="button"
                disabled={busy}
                onClick={onClick}
              >
                {label}
              </button>
            ))}
          </div>

          {confirming ? (
            <div className="confirm" role="alertdialog" aria-live="assertive">
              <p>{CONFIRM_COPY[confirming].question}</p>
              <div className="actions">
                <button
                  className="button danger"
                  type="button"
                  disabled={busy}
                  onClick={confirm}
                >
                  {CONFIRM_COPY[confirming].confirm}
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
