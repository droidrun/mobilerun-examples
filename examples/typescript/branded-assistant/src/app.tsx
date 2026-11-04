import { useEffect, useState, type FormEvent } from 'react';
import {
  isTerminal, type Result, type RunStatus, type RunView, type SessionView,
} from '@/shared/contracts';
import { brand } from './client/brand';
import { AppShell, Notice, type Tone } from './client/components/app-shell';
import { useAssistant, type AssistantNotice } from './client/use-assistant';

/** Pill text and tone per status. A failed run is no alarm: often the assistant declined. */
const STATUS: Record<RunStatus, { pill: string; tone: Tone }> = {
  starting: { pill: 'Starting', tone: 'busy' },
  running: { pill: 'In progress', tone: 'busy' },
  unknown: { pill: 'Checking', tone: 'busy' },
  cancelling: { pill: 'Stopping', tone: 'busy' },
  completed: { pill: 'Done', tone: 'live' },
  cancelled: { pill: 'Stopped', tone: 'neutral' },
  failed: { pill: "Couldn't finish", tone: 'neutral' },
};
/** Statuses in which the assistant works and takes notes. */
const WORKING: ReadonlyArray<RunStatus> = ['starting', 'running', 'cancelling'];
const NOTHING_CHANGED = 'Nothing was booked or changed.';

type Send = (text: string) => Promise<boolean>;

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

/** A text box that keeps its text when sending failed. */
function useTextForm(send: Send) {
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

type RequestPanelProps = {
  session: SessionView;
  error?: string;
  start: (presetId: string, text: string) => Promise<boolean>;
};

function RequestPanel({ session, error, start }: RequestPanelProps) {
  const { persona, presets, run, reservePerRun } = session;
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
      <label className="field">
        Your request
        <textarea
          className="input"
          rows={3}
          maxLength={2_000}
          value={form.text}
          placeholder={presets.find((preset) => preset.id === presetId)?.hint}
          onChange={(event) => form.onChange(event.target.value)}
        />
      </label>
      {error && <Notice text={error} />}
      <div className="actions">
        <button className="btn btn-primary" disabled={busy || form.empty}>
          Ask {persona.name}
        </button>
      </div>
      <p className="small">
        {busy
          ? `${persona.name} is on it. You can ask again when this one is done.`
          : `A request holds ${reservePerRun} credits until done. You pay what it uses.`}
      </p>
    </form>
  );
}

/** Before the first request: what the assistant does. */
export function Welcome({ name }: { name: string }) {
  return (
    <section className="card stack">
      <h2>{brand.tagline}</h2>
      <ol className="how">
        <li>Pick what you need and describe it.</li>
        <li>{name} looks it up on a real phone. Add a note at any time.</li>
        <li>The answer shows up here.</li>
      </ol>
      <p className="small">{name} only researches: nothing is booked or paid.</p>
    </section>
  );
}

type RunPanelProps = {
  run: RunView;
  /** The assistant's name and the preset's label. */
  name: string;
  title: string;
  error?: string;
  sendNote: Send;
  stop: () => Promise<boolean>;
};

/** The run while it works: status, request, activity, and the note box. */
function RunCard({ run, title, error, sendNote, stop }: RunPanelProps) {
  const note = useTextForm(sendNote);
  const { pill, tone } = STATUS[run.status];
  const working = WORKING.includes(run.status);
  const doing = run.status === 'cancelling' ? 'Stopping… ' : 'Working… ';
  const steps = run.steps ? ` · Step ${run.steps}` : '';
  const used = run.charged === null ? '' : `Used ${run.charged} credits`;
  return (
    <section className="card stack">
      <div className="run-head">
        <span className="pill" data-tone={tone}>{pill}</span>
        <span className="small">
          {working ? <>{doing}<Clock from={run.createdAt} />{steps}</> : used}
        </span>
      </div>
      <div>
        <p className="small">{title}</p>
        <p className="asked">{run.request}</p>
      </div>
      {working && <div className="progress" role="progressbar" aria-label="Working on it" />}
      {run.error && <Notice tone="warn" text={run.error} />}
      {run.timeline.length > 0 && (
        <ol className="activity" aria-label="Activity">
          {run.timeline.map(({ kind, text }, index) => (
            <li key={index} className={kind}>{kind === 'user' ? `You: ${text}` : text}</li>
          ))}
        </ol>
      )}
      {working && (
        <form className="note" onSubmit={note.submit}>
          <input
            className="input"
            value={note.text}
            maxLength={1_000}
            placeholder="Add a note, e.g. under €100 a night"
            aria-label="Add a note"
            onChange={(event) => note.onChange(event.target.value)}
          />
          <button className="btn" disabled={note.sending || note.empty}>Send</button>
        </form>
      )}
      {error && <Notice text={error} />}
      {working && (
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
    </section>
  );
}

function ResultRows({ rows, missing }: Result) {
  if (rows.length === 0) return <p className="muted">I could not find this one.</p>;
  return (
    <>
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
      {missing.length > 0 && <p className="small">{`Not found: ${missing.join(', ')}`}</p>}
    </>
  );
}

/** A finished run, once: what happened, the assistant's own words, and the result. */
function Outcome({ run, title, name }: Pick<RunPanelProps, 'run' | 'title' | 'name'>) {
  const { status, result, rawOutput, message } = run;
  // A failed task may still carry the assistant's words, for example when it declined.
  const said = status === 'failed' && !result ? [message, rawOutput] : [];
  const words = said.filter((text): text is string => Boolean(text));
  return (
    <section className="card stack" aria-label="Result">
      <h2>{title}</h2>
      {status === 'failed' && !result && (
        <p className="muted">{`${name} couldn't do this one.`}</p>
      )}
      {words.map((text) => <blockquote key={text} className="reply">{text}</blockquote>)}
      {status === 'cancelled' && <p className="muted">{message ?? NOTHING_CHANGED}</p>}
      {result ? (
        <ResultRows {...result} />
      ) : status === 'completed' ? (
        <details>
          <summary className="muted">The result could not be read.</summary>
          <pre className="raw">{rawOutput ?? 'Nothing came back.'}</pre>
        </details>
      ) : (
        status === 'failed' && words.length === 0 && <p className="muted">{NOTHING_CHANGED}</p>
      )}
    </section>
  );
}

/** The latest run: its card, and its outcome once it ended. */
export function RunPanel(props: RunPanelProps) {
  const { run, title, name } = props;
  return (
    <div className="stack" aria-live="polite">
      <RunCard {...props} />
      {isTerminal(run.status) && <Outcome run={run} title={title} name={name} />}
    </div>
  );
}

export function App() {
  const assistant = useAssistant();
  const { session, notice } = assistant;
  const errorAt = (at: AssistantNotice['at']) => (notice?.at === at ? notice.text : undefined);
  if (!session) {
    return (
      <AppShell>
        {assistant.loadFailed ? (
          <div className="stack">
            <Notice text="We could not load your assistant." />
            <div className="actions">
              <button className="btn" onClick={assistant.reload}>Try again</button>
            </div>
          </div>
        ) : (
          <div className="progress" role="progressbar" aria-label="Loading" />
        )}
      </AppShell>
    );
  }

  const { persona, presets, run, balance } = session;
  const title = presets.find((preset) => preset.id === run?.presetId)?.label ?? 'Result';
  const credits = (
    <span className="topbar-meta"><span className="num">{balance}</span> credits</span>
  );
  return (
    <AppShell right={credits}>
      <div className={run ? 'split split-fill has-run' : 'split split-fill'}>
        <RequestPanel session={session} error={errorAt('start')} start={assistant.start} />
        {run ? (
          <RunPanel
            run={run}
            name={persona.name}
            title={title}
            error={errorAt('run')}
            sendNote={assistant.sendNote}
            stop={assistant.stop}
          />
        ) : (
          <Welcome name={persona.name} />
        )}
      </div>
    </AppShell>
  );
}
