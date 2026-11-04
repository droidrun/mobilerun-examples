import { useEffect, useState } from 'react';
import { brand } from './client/brand';
import { AppShell, Notice, type Tone } from './client/components/app-shell';
import { PhoneFrame } from './client/components/phone-frame';
import { useDemo, type Demo } from './client/use-demo';

/** Where "Get Fernly" leads. Point it at your store listing. */
const GET_APP_URL = 'https://example.com/get-fernly';
const { company, product } = brand;
const KEEP_GOING = `Get ${product} on your own phone and keep going.`;

/** The phone frame per phase: its pill, the pill's tone, and the line on the empty screen. */
const PHONE: Record<Demo['phase'], { pill: string; tone: Tone; line: string }> = {
  idle: { pill: 'Not started', tone: 'neutral', line: `${product} opens here.` },
  starting: { pill: 'Starting', tone: 'busy', line: 'Getting a phone ready…' },
  live: { pill: 'Live', tone: 'live', line: 'Connecting…' },
  ending: { pill: 'Ending', tone: 'busy', line: 'Ending your demo…' },
  ended: { pill: 'Ended', tone: 'neutral', line: 'This demo has ended.' },
};

/** m:ss since `from` or until `to`. Ticks on its own so the phone stream does not re-render. */
function Clock({ from = 0, to }: { from?: number; to?: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((to ? to - now : now - from) / 1_000));
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <span className="num">{text}</span>;
}

const GetApp = ({ primary = false }) => (
  <a className={primary ? 'btn btn-primary' : 'btn'} href={GET_APP_URL}>Get {product}</a>
);

function Panel({ demo, start, end, reset }: ReturnType<typeof useDemo>) {
  switch (demo.phase) {
    case 'starting':
      return (
        <>
          <h1>Getting your phone ready</h1>
          <p className="muted">
            {product} opens by itself when the phone is ready. This usually takes under a minute.
          </p>
          <div className="progress" role="progressbar" aria-label="Starting the demo" />
          <p className="small">Waiting <Clock from={demo.since} /></p>
        </>
      );
    case 'live':
    case 'ending':
      return (
        <>
          <h1>You are using {product}</h1>
          <p className="muted">
            Tap, swipe and type on the phone. Back, Home and Recents sit under the screen.
          </p>
          <p className="small">It stays in {product} for this demo and is wiped when it ends.</p>
          {demo.notice && <Notice {...demo.notice} />}
          <div className="actions">
            <button
              className="btn btn-danger"
              onClick={() => end(demo.id)}
              disabled={demo.phase === 'ending'}
            >
              {demo.phase === 'ending' ? 'Ending…' : 'End demo'}
            </button>
          </div>
        </>
      );
    case 'ended':
      // Only an end the server confirmed says the phone is released; after the
      // countdown, cleanup is the server's job.
      return (
        <>
          <h1>{demo.expired ? 'Your demo time is up' : `Thanks for trying ${product}`}</h1>
          <p className="muted">
            {demo.expired ? KEEP_GOING : `The demo phone has been released. ${KEEP_GOING}`}
          </p>
          <div className="actions">
            <GetApp primary />
            <button className="btn" onClick={reset}>Start another demo</button>
          </div>
        </>
      );
    case 'idle':
      return (
        <>
          <h1>{brand.tagline}</h1>
          <p className="muted">Try {product} on a real phone, right here in your browser.</p>
          <dl className="card facts">
            <dt>Setup</dt>
            <dd>No download, no sign-up</dd>
            <dt>Start</dt>
            <dd>About a minute</dd>
            <dt>Length</dt>
            <dd>A few minutes, then it ends by itself</dd>
          </dl>
          {demo.notice && <Notice {...demo.notice} />}
          <div className="actions">
            <button className="btn btn-primary" onClick={start}>Start demo</button>
          </div>
          <p className="small">{company} resets the phone after every demo.</p>
        </>
      );
  }
}

export function App() {
  const state = useDemo();
  const { demo, refreshStream } = state;
  const session = demo.phase === 'live' || demo.phase === 'ending' ? demo : undefined;
  const right = session ? (
    <span className="topbar-meta"><Clock to={session.deadline} /> left</span>
  ) : (
    demo.phase !== 'ended' && <GetApp />
  );

  return (
    <AppShell right={right}>
      <div className="split">
        <section className="stack" aria-live="polite">
          <Panel {...state} />
        </section>
        <PhoneFrame
          {...PHONE[demo.phase]}
          stream={session?.stream}
          hasControl={demo.phase === 'live'}
          onStreamHealed={() => session && refreshStream(session.id)}
        />
      </div>
    </AppShell>
  );
}
