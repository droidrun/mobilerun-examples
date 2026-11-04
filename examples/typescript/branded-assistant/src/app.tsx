import { useEffect, useState, type FormEvent } from 'react';
import { isTerminal, type RunStatus, type RunView, type SessionView } from '@/shared/contracts';
import { brand } from './client/brand';
import { AppShell } from './client/components/app-shell';
import type { Tone } from './client/components/phone-frame';
import { useAssistant } from './client/use-assistant';

/** Pill text and tone per status. A failed run is no alarm: often the assistant declined. */
const STATUS: Record<RunStatus, [label: string, tone: Tone]> = {
  starting: ['Starting', 'busy'], running: ['In progress', 'busy'], unknown: ['Checking', 'busy'],
  cancelling: ['Stopping', 'busy'], completed: ['Done', 'live'], cancelled: ['Stopped', 'neutral'],
  failed: ["Couldn't finish", 'neutral'],
};
const NOTHING_CHANGED = 'Nothing was booked or changed.';
type Props = ReturnType<typeof useAssistant> & { session: SessionView };

/** m:ss since `from`, ticking on its own. */
function Clock({ from }: { from: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(from)) / 1_000));
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <span className="num">{text}</span>;
}

const Alert = ({ text, tone = 'danger' }: { text?: string | false | null; tone?: string }) =>
  text ? <p className="notice" data-tone={tone} role="alert">{text}</p> : null;

/** A text box that keeps its text when sending failed. */
function useTextForm(send: (text: string) => Promise<boolean>) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending || !text.trim()) return;
    setSending(true);
    if (await send(text.trim())) setText('');
    setSending(false);
  };
  return { text, sending, submit, empty: !text.trim(), onChange: setText };
}

function RequestPanel({ session, start, notice }: Props) {
  const { persona, presets, run } = session;
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '');
  const form = useTextForm((text) => start(presetId, text));
  const busy = form.sending || (run !== null && !isTerminal(run.status));
  return (
    <form className="stack" onSubmit={form.submit}>
      <header className="persona">
        <span className="avatar" aria-hidden="true">{persona.name.slice(0, 1)}</span>
        <div>
          <h1>{persona.name}</h1>
          <p className="muted">{persona.role}</p>
        </div>
      </header>
      <fieldset className="presets">
        <legend>What should I look up?</legend>
        {presets.map(({ id, label, hint }) => (
          <label key={id} className="card preset">
            <input type="radio" name="preset" checked={id === presetId}
              onChange={() => setPresetId(id)} />
            <span>
              <strong>{label}</strong>
              <span className="small">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="stack-tight">
        <span className="label">Your request</span>
        <textarea
          className="field"
          rows={3}
          maxLength={2_000}
          value={form.text}
          placeholder={presets.find((preset) => preset.id === presetId)?.hint}
          onChange={(event) => form.onChange(event.target.value)}
        />
      </label>
      <Alert text={notice?.at === 'start' && notice.text} />
      <div className="actions">
        <button className="btn btn-primary" disabled={busy || form.empty}>
          Ask {persona.name}
        </button>
      </div>
      <p className="small">
        {busy
          ? `${persona.name} is on it. You can ask again when this one is done.`
          : `A request holds ${session.reservePerRun} credits until done. You pay what it uses.`}
      </p>
    </form>
  );
}

/** A finished run: the result card, or the assistant's own words, or what happened. */
function Outcome({ run, title, name }: { run: RunView; title: string; name: string }) {
  if (run.result) {
    const { rows, missing } = run.result;
    return (
      <section className="card stack" aria-label="Result">
        <h2>{title}</h2>
        {rows.length === 0 && <p className="muted">I could not find this one.</p>}
        <dl className="rows">
          {rows.map(({ label, value }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {Array.isArray(value) ? (
                  <ul>{value.map((item) => <li key={item}>{item}</li>)}</ul>
                ) : value}
              </dd>
            </div>
          ))}
        </dl>
        {rows.length > 0 && missing.length > 0 && (
          <p className="small">{`Not found: ${missing.join(', ')}`}</p>
        )}
      </section>
    );
  }
  if (run.status === 'cancelled') return <p className="muted">{run.message ?? NOTHING_CHANGED}</p>;
  if (run.status === 'completed') {
    return (
      <details>
        <summary className="muted">The result could not be read.</summary>
        <pre className="raw">{run.rawOutput ?? 'Nothing came back.'}</pre>
      </details>
    );
  }
  // A failed task may still carry the assistant's words, for example when it declined.
  const words = [run.message, run.rawOutput].filter((text): text is string => Boolean(text));
  return (
    <>
      <p className="muted">{name} couldn't do this one.</p>
      {words.map((text) => <blockquote key={text} className="reply">{text}</blockquote>)}
      {words.length === 0 && <p className="muted">{NOTHING_CHANGED}</p>}
    </>
  );
}

export function RunPanel({ session, notice, sendNote, stop }: Props) {
  const { run, persona, presets } = session;
  const note = useTextForm(sendNote);
  if (!run) {
    return (
      <section className="card stack">
        <h2>{brand.tagline}</h2>
        <ol className="how">
          <li>Pick what you need and describe it.</li>
          <li>{persona.name} looks it up on a real phone. Add a note at any time.</li>
          <li>The answer shows up here.</li>
        </ol>
        <p className="small">{persona.name} only researches: nothing is booked or paid.</p>
      </section>
    );
  }
  const [label, tone] = STATUS[run.status];
  const working = ['starting', 'running', 'cancelling'].includes(run.status);
  const canTalk = !isTerminal(run.status) && run.status !== 'unknown';
  const title = presets.find((preset) => preset.id === run.presetId)?.label ?? 'Result';
  const outcome = isTerminal(run.status) && <Outcome run={run} title={title} name={persona.name} />;
  return (
    <div className="stack" aria-live="polite">
      <section className="card stack">
        <div className="run-head">
          <span className="pill" data-tone={tone}>{label}</span>
          <span className="small">
            {working && (run.status === 'cancelling' ? 'Stopping… ' : 'Working… ')}
            {working && <Clock from={run.createdAt} />}
            {working && run.steps ? ` · Step ${run.steps}` : ''}
            {run.charged !== null && `Used ${run.charged} credits`}
          </span>
        </div>
        <div>
          <p className="small">{title}</p>
          <p className="asked">{run.request}</p>
        </div>
        {working && <div className="progress" role="progressbar" aria-label="Working on it" />}
        <Alert text={run.error} tone="warn" />
        {run.timeline.length > 0 && (
          <ol className="activity" aria-label="Activity">
            {run.timeline.map(({ kind, text }, index) => (
              <li key={index} className={kind}>{kind === 'user' ? `You: ${text}` : text}</li>
            ))}
          </ol>
        )}
        {canTalk && (
          <form className="note" onSubmit={note.submit}>
            <input
              className="field"
              value={note.text}
              maxLength={1_000}
              placeholder="Add a note, e.g. under €100 a night"
              aria-label="Add a note"
              onChange={(event) => note.onChange(event.target.value)}
            />
            <button className="btn" disabled={note.sending || note.empty}>Send</button>
          </form>
        )}
        <Alert text={notice?.at === 'run' && notice.text} />
        {canTalk && (
          <div className="actions">
            <button
              type="button"
              className="btn btn-danger"
              disabled={run.status === 'cancelling'}
              onClick={stop}
            >
              Stop
            </button>
          </div>
        )}
        {!run.result && outcome}
      </section>
      {run.result && outcome}
    </div>
  );
}

export function App() {
  const state = useAssistant();
  const { session, loadFailed, reload } = state;
  const credits = session && (
    <span className="credits"><span className="num">{session.balance}</span> credits</span>
  );
  return (
    <AppShell product={brand.product} right={credits}>
      {session ? (
        <div className={session.run ? 'split workspace has-run' : 'split workspace'}>
          <RequestPanel {...state} session={session} />
          <RunPanel {...state} session={session} />
        </div>
      ) : loadFailed ? (
        <div className="stack">
          <Alert text="We could not load your assistant." />
          <div className="actions"><button className="btn" onClick={reload}>Try again</button></div>
        </div>
      ) : (
        <div className="progress" role="progressbar" aria-label="Loading" />
      )}
    </AppShell>
  );
}
