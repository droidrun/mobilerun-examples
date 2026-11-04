import { useState } from 'react';
import { brand } from './client/brand';
import { AppShell, Notice, type Tone } from './client/components/app-shell';
import { PhoneFrame } from './client/components/phone-frame';
import { usePortal, type Portal } from './client/use-portal';
import type { DeviceAction, DeviceView } from './shared/contracts';

const { product } = brand;

/** The phone frame per screen: its pill, the pill's tone, and the line on the empty screen. */
const PHONE = {
  loading: { pill: 'Loading', tone: 'busy', line: 'One moment…' },
  signedOut: { pill: 'Signed out', tone: 'neutral', line: 'Your phone opens here after sign-in.' },
  none: { pill: 'No phone', tone: 'neutral', line: 'You do not have a phone yet.' },
  deleted: { pill: 'Deleted', tone: 'neutral', line: 'This phone was deleted.' },
  // The device states, in this product's own words.
  creating: { pill: 'Setting up', tone: 'busy', line: 'Setting up your phone…' },
  assigned: { pill: 'Starting', tone: 'busy', line: 'Starting your phone…' },
  ready: { pill: 'Online', tone: 'live', line: 'Connecting…' },
  rebooting: { pill: 'Restarting', tone: 'busy', line: 'Restarting…' },
  resetting: { pill: 'Resetting', tone: 'busy', line: 'Resetting…' },
  migrating: { pill: 'Moving', tone: 'busy', line: 'Moving your phone…' },
  maintenance: { pill: 'Maintenance', tone: 'neutral', line: 'Your phone is under maintenance.' },
  stopped: { pill: 'Stopped', tone: 'neutral', line: 'Your phone is stopped.' },
  unavailable: { pill: 'Unavailable', tone: 'danger', line: 'Your phone is unavailable.' },
} satisfies Record<string, { pill: string; tone: Tone; line: string }>;
type Screen = keyof typeof PHONE;

/** Which row of PHONE the page shows. A device state this page does not know is unavailable. */
function screenOf({ email, device, deleted }: Portal): Screen {
  if (email === undefined || (email && device === undefined)) return 'loading';
  if (!email) return 'signedOut';
  if (!device) return deleted ? 'deleted' : 'none';
  return Object.hasOwn(PHONE, device.state) ? (device.state as Screen) : 'unavailable';
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
          <input className="input" type="email" autoComplete="email" placeholder="you@example.com"
            required value={email} onChange={(event) => setEmail(event.target.value)} />
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
/** Each button: its text, its text while its request runs, and its classes. */
const BUTTONS: Record<Step, { label: string; busy: string; className: string }> = {
  stop: { label: 'Stop', busy: 'Stopping…', className: 'btn' },
  resume: { label: 'Start', busy: 'Starting…', className: 'btn btn-primary' },
  reboot: { label: 'Restart', busy: 'Restarting…', className: 'btn' },
  reset: { label: 'Reset', busy: 'Resetting…', className: 'btn' },
  delete: { label: 'Delete', busy: 'Deleting…', className: 'btn btn-danger' },
};
/** Steps that erase data ask in the page first. */
const CONFIRM: Partial<Record<Step, { question: string; answer: string }>> = {
  reset: {
    question: 'Reset your phone? Its apps, accounts and files are erased.',
    answer: 'Yes, reset',
  },
  delete: { question: 'Delete your phone? This cannot be undone.', answer: 'Yes, delete' },
};

function PhonePanel({ device, pending, act, remove }: Portal & { device: DeviceView }) {
  const [confirm, setConfirm] = useState<Step>();
  const question = confirm && CONFIRM[confirm];
  const settingUp = device.state === 'creating' || device.state === 'assigned';
  const stopped = device.state === 'stopped';
  const run = (step: Step) => (step === 'delete' ? remove() : act(step));
  const steps: Array<Step> = [stopped ? 'resume' : 'stop', 'reboot', 'reset', 'delete'];

  return (
    <>
      <h1>Your {product}</h1>
      <p className="muted">
        {settingUp
          ? 'This takes a minute or two. Your phone opens here as soon as it is ready.'
          : stopped
            ? 'Start it to use it again. Your apps and files are kept.'
            : 'Tap, swipe and type on the screen. Back, Home and Recents sit under it.'}
      </p>
      {settingUp && <div className="progress" role="progressbar" aria-label="Setting up" />}
      <p className="small">Created {new Date(device.createdAt).toLocaleDateString()}</p>
      {confirm && question ? (
        <div className="stack" role="alertdialog" aria-label="Confirm">
          <Notice text={question.question} />
          <div className="actions">
            <button
              className="btn btn-danger"
              onClick={() => {
                setConfirm(undefined);
                void run(confirm);
              }}
            >
              {question.answer}
            </button>
            <button className="btn" onClick={() => setConfirm(undefined)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="actions">
          {steps.map((step) => (
            <button
              key={step}
              className={BUTTONS[step].className}
              disabled={!!pending}
              onClick={() => (step in CONFIRM ? setConfirm(step) : run(step))}
            >
              {pending === step ? BUTTONS[step].busy : BUTTONS[step].label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Panel(portal: Portal) {
  const screen = screenOf(portal);
  if (screen === 'loading') {
    return <div className="progress" role="progressbar" aria-label="Loading" />;
  }
  if (screen === 'signedOut') return <SignIn {...portal} />;
  const { device } = portal;
  return device ? <PhonePanel {...portal} device={device} /> : <GetPhone {...portal} />;
}

export function App() {
  const portal = usePortal();
  const { email, stream, streamProblem, notice, pending } = portal;
  const phone = PHONE[screenOf(portal)];
  const account = email && (
    <div className="account">
      <span className="small">{email}</span>
      <button className="btn" onClick={portal.signOut} disabled={!!pending}>
        Sign out
      </button>
    </div>
  );

  return (
    <AppShell right={account}>
      <div className="split">
        <section className="stack" aria-live="polite">
          <Panel {...portal} />
          {notice && <Notice text={notice} />}
        </section>
        <PhoneFrame
          {...phone}
          line={streamProblem ?? phone.line}
          stream={stream}
          hasControl
          onStreamHealed={portal.refreshStream}
        />
      </div>
    </AppShell>
  );
}
