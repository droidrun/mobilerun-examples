import type { Brand } from '@/shared/contracts';
import { formatRemaining } from '@/client/format-time';
import { remainingMs, type DemoState } from '@/client/demo-machine';
import { useNow } from '@/client/use-now';

type DemoPanelProps = {
  brand: Brand;
  state: DemoState;
  onStart: () => void;
  onEnd: () => void;
  onReset: () => void;
};

export function DemoPanel({ brand, state, onStart, onEnd, onReset }: DemoPanelProps) {
  const ticking = state.phase === 'live' || state.phase === 'ending';
  const now = useNow(ticking);

  if (state.phase === 'loading') {
    return <p className="status">Loading…</p>;
  }

  if (state.phase === 'unavailable') {
    return (
      <>
        <h1>The live demo is not available right now.</h1>
        <p className="notice" role="alert">
          API key missing. Set <code>MOBILERUN_CLOUD_API_KEY</code> in the
          server environment and restart.
        </p>
        <a className="button secondary" href={brand.getAppUrl}>
          Get {brand.name}
        </a>
      </>
    );
  }

  if (state.phase === 'ended') {
    return (
      <>
        <p className="kicker">
          {state.endReason === 'expired' ? 'Demo time is up' : 'Demo ended'}
        </p>
        <h1>Like what you saw?</h1>
        <p className="pitch">
          Get {brand.name} on your own phone and keep going. The demo phone has
          been wiped and released.
        </p>
        <div className="actions">
          <a className="button" href={brand.getAppUrl}>
            Get {brand.name}
          </a>
          <button type="button" className="button secondary" onClick={onReset}>
            Start another demo
          </button>
        </div>
      </>
    );
  }

  if (state.phase === 'live' || state.phase === 'ending') {
    return (
      <>
        <p className="kicker">Live demo</p>
        <h1>You are in control.</h1>
        <p className="pitch">
          Tap, swipe and type on the phone. It is locked to {brand.name} for
          this demo.
        </p>
        <p className="countdown" role="timer" aria-label="Time left">
          <span>{formatRemaining(remainingMs(state, now))}</span>
          <small>left</small>
        </p>
        {state.error ? (
          <p className="notice" role="alert">
            {state.error}
          </p>
        ) : null}
        <div className="actions">
          <button
            type="button"
            className="button secondary"
            onClick={onEnd}
            disabled={state.phase === 'ending'}
          >
            {state.phase === 'ending' ? 'Ending…' : 'End demo'}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="kicker">{brand.tagline}</p>
      <h1>{brand.headline}</h1>
      <p className="pitch">{brand.pitch}</p>
      {state.error ? (
        <p className="notice" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="actions">
        <button
          type="button"
          className="button"
          onClick={onStart}
          disabled={state.phase === 'starting'}
        >
          {state.phase === 'starting' ? 'Starting…' : 'Try it'}
        </button>
        <a className="button secondary" href={brand.getAppUrl}>
          Get {brand.name}
        </a>
      </div>
    </>
  );
}
