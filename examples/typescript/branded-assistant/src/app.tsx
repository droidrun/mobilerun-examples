import { useEffect, useRef } from 'react';
import { brand } from '@/shared/brand';
import { Composer } from './client/components/composer';
import { PersonaHeader } from './client/components/persona-header';
import { RunMessage } from './client/components/run-message';
import { useAssistant } from './client/use-assistant';

export function App() {
  const { state, active, start, reply, cancel, reload, dismissError } = useAssistant();
  const { runs } = state;
  const endRef = useRef<HTMLDivElement>(null);
  const lastEntry = runs.at(-1)?.timeline.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [runs.length, lastEntry, active?.status]);

  const { presets } = state;
  const ready = state.phase === 'ready';
  const notReady = ready && (!state.sdkConfigured || state.deviceCount === 0);

  return (
    <main className="shell">
      <PersonaHeader
        persona={state.persona}
        balance={state.balance}
        reservePerRun={state.reservePerRun}
      />

      {state.phase === 'failed' ? (
        <div className="notice notice-error" role="alert">
          <span>{state.error}</span>
          <button type="button" className="link" onClick={reload}>
            Try again
          </button>
        </div>
      ) : null}

      {ready && !state.sdkConfigured ? (
        <div className="notice" role="status">
          <strong>API key missing.</strong> Set <code>MOBILERUN_CLOUD_API_KEY</code> on the server and
          restart. The page works, but requests cannot start yet.
        </div>
      ) : null}
      {ready && state.sdkConfigured && state.deviceCount === 0 ? (
        <div className="notice" role="status">
          <strong>No phones configured.</strong> Add cloud phone ids to <code>DEVICE_IDS</code> on
          the server.
        </div>
      ) : null}

      <section className="thread" aria-live="polite">
        {state.phase === 'loading' ? <p className="muted">Loading…</p> : null}
        {ready && runs.length === 0 ? (
          <div className="bubble bubble-assistant">
            Hi, I'm {state.persona?.displayName}. Pick a request type and tell me what you need. I
            look things up on a real phone and show you how it goes.
          </div>
        ) : null}
        {runs.map((run) => (
          <RunMessage
            key={run.id}
            run={run}
            preset={presets.find((item) => item.id === run.presetId)}
            isActive={run.id === active?.id}
            reply={reply}
            cancel={cancel}
          />
        ))}
        <div ref={endRef} />
      </section>

      {state.error && state.phase !== 'failed' ? (
        <div className="notice notice-error" role="alert">
          <span>{state.error}</span>
          <button type="button" className="link" onClick={dismissError}>
            Dismiss
          </button>
        </div>
      ) : null}

      {ready ? (
        <Composer presets={presets} disabled={active !== null || notReady} start={start} />
      ) : null}

      <footer>
        <span>{brand.name}</span>
        <span>Demo balance, resets with the example database</span>
      </footer>
    </main>
  );
}
