import { useState } from 'react';
import { brand } from './client/brand';
import { AppShell } from './client/components/app-shell';
import { PhoneFrame, type Tone } from './client/components/phone-frame';
import { usePortal, type Portal } from './client/use-portal';
import type { DeviceAction, DeviceView } from './shared/contracts';

const { product } = brand;
type Look = [status: string, tone: Tone, line: string];

/** The device state as the user sees it: pill text, tone, and the line on the empty screen. */
const STATES: Record<string, Look> = {
  creating: ['Setting up', 'busy', 'Setting up your phone…'],
  assigned: ['Starting', 'busy', 'Starting your phone…'],
  ready: ['Online', 'live', 'Connecting…'],
  rebooting: ['Restarting', 'busy', 'Restarting…'],
  resetting: ['Resetting', 'busy', 'Resetting…'],
  migrating: ['Moving', 'busy', 'Moving your phone…'],
  maintenance: ['Maintenance', 'neutral', 'Your phone is under maintenance.'],
  stopped: ['Stopped', 'neutral', 'Your phone is stopped.'],
};
const lookOf = (state: string): Look =>
  STATES[state] ?? ['Unavailable', 'danger', 'Your phone is unavailable.'];

/** Still checking the session, or signed in and the device not loaded yet. */
const loading = ({ email, device }: Portal) =>
  email === undefined || (email !== null && device === undefined);

/** What the phone frame shows while there is no stream. Its pill is about the screen. */
function frame(portal: Portal): Look {
  const { email, device, deleted } = portal;
  if (loading(portal)) return ['Loading', 'busy', 'One moment…'];
  if (!email) return ['Signed out', 'neutral', 'Your phone opens here after you sign in.'];
  if (device) {
    const [, tone, line] = lookOf(device.state);
    return tone === 'busy' || tone === 'live' ? ['Waiting', 'busy', line] : ['Off', tone, line];
  }
  if (deleted) return ['Deleted', 'neutral', 'This phone was deleted.'];
  return ['No phone', 'neutral', 'You do not have a phone yet.'];
}

function SignIn({ signIn, pending }: Portal) {
  const [email, setEmail] = useState('');
  return (
    <>
      <h1>{brand.tagline}</h1>
      <p className="muted">Sign in to open your phone.</p>
      <form
        className="card stack"
        onSubmit={(event) => {
          event.preventDefault();
          void signIn(email);
        }}
      >
        <label className="field">
          Email
          <input type="email" autoComplete="email" placeholder="you@example.com" required
            value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <button className="btn btn-primary" disabled={!!pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="small">Demo sign-in: it stands in for your own login, and any email works.</p>
    </>
  );
}

function GetPhone({ create, pending, deleted }: Portal) {
  return (
    <>
      <h1>{deleted ? 'Your phone is deleted' : `Get your own ${product}`}</h1>
      <p className="muted">
        {deleted
          ? 'Its apps and files are gone. You can get a new phone at any time.'
          : 'An Android phone in the cloud that you use right here, from any computer.'}
      </p>
      <div className="actions">
        <button className="btn btn-primary" onClick={create} disabled={!!pending}>
          {pending ? 'Getting your phone…' : deleted ? 'Get a new phone' : 'Get my phone'}
        </button>
      </div>
    </>
  );
}

type Step = DeviceAction | 'delete';
/** Button text, the text while its request runs, and the class. */
const BUTTONS: Record<Step, [string, string, string?]> = {
  stop: ['Stop', 'Stopping…'],
  resume: ['Start', 'Starting…', 'btn-primary'],
  reboot: ['Restart', 'Restarting…'],
  reset: ['Reset', 'Resetting…'],
  delete: ['Delete', 'Deleting…', 'btn-danger'],
};
/** Steps that erase data ask in the page first: question and answer. */
const CONFIRM = {
  reset: ['Reset your phone? Its apps, accounts and files are erased.', 'Yes, reset'],
  delete: ['Delete your phone? This cannot be undone.', 'Yes, delete'],
} as const;

function PhonePanel({ device, pending, act, remove }: Portal & { device: DeviceView }) {
  const [confirm, setConfirm] = useState<keyof typeof CONFIRM>();
  const [status, tone] = lookOf(device.state);
  const settingUp = device.state === 'creating' || device.state === 'assigned';
  const stopped = device.state === 'stopped';
  const run = (step: Step) => (step === 'delete' ? remove() : act(step));

  return (
    <>
      <div className="phone-head">
        <h1>Your {product}</h1>
        <span className="pill" data-tone={tone}>{status}</span>
      </div>
      <p className="muted">
        {settingUp
          ? 'This takes a minute or two. Your phone opens here as soon as it is ready.'
          : stopped
            ? 'Start it to use it again. Your apps and files are kept.'
            : 'Tap, swipe and type on the screen. Back, Home and Recents sit under it.'}
      </p>
      {settingUp && <div className="progress" role="progressbar" aria-label="Setting up" />}
      <p className="small">Created {new Date(device.createdAt).toLocaleDateString()}</p>
      {confirm ? (
        <div className="notice" data-tone="danger" role="alertdialog" aria-label="Confirm">
          <div className="stack">
            <p>{CONFIRM[confirm][0]}</p>
            <div className="actions">
              <button
                className="btn btn-danger"
                onClick={() => {
                  setConfirm(undefined);
                  void run(confirm);
                }}
              >
                {CONFIRM[confirm][1]}
              </button>
              <button className="btn" onClick={() => setConfirm(undefined)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="actions">
          {([stopped ? 'resume' : 'stop', 'reboot', 'reset', 'delete'] as const).map((step) => (
            <button
              key={step}
              className={`btn ${BUTTONS[step][2] ?? ''}`}
              disabled={!!pending}
              onClick={() => (step === 'reset' || step === 'delete' ? setConfirm(step) : run(step))}
            >
              {BUTTONS[step][pending === step ? 1 : 0]}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Panel(portal: Portal) {
  if (loading(portal)) return <div className="progress" role="progressbar" aria-label="Loading" />;
  if (!portal.email) return <SignIn {...portal} />;
  const { device } = portal;
  return device ? <PhonePanel {...portal} device={device} /> : <GetPhone {...portal} />;
}

export function App() {
  const portal = usePortal();
  const { email, stream, streamProblem, notice } = portal;
  const [status, tone, line] = frame(portal);
  const account = email && (
    <div className="account">
      <span className="small">{email}</span>
      <button className="btn" onClick={portal.signOut} disabled={!!portal.pending}>
        Sign out
      </button>
    </div>
  );

  return (
    <AppShell product={product} right={account}>
      <div className="split">
        <section className="stack" aria-live="polite">
          <Panel {...portal} />
          {notice && <p className="notice" data-tone="danger" role="alert">{notice}</p>}
        </section>
        <PhoneFrame
          stream={stream && { url: stream.streamUrl, token: stream.streamToken }}
          label={streamProblem ?? line}
          hasControl
          status={stream ? 'Live' : status}
          tone={stream ? 'live' : tone}
          onStreamHealed={portal.refreshStream}
        />
      </div>
    </AppShell>
  );
}
