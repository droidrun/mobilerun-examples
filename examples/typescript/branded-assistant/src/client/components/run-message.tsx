import { useState, type FormEvent } from 'react';
import { isTerminalStatus, type PublicPreset, type RunView } from '@/shared/contracts';
import { statusLabel } from '../status-label';
import { ProgressTimeline } from './progress-timeline';
import { ResultCard } from './result-card';
import { WatchPanel } from './watch-panel';

type RunMessageProps = {
  run: RunView;
  preset: PublicPreset | undefined;
  isActive: boolean;
  reply: (message: string) => Promise<void>;
  cancel: () => Promise<void>;
};

function ReplyForm({ run, reply }: Pick<RunMessageProps, 'run' | 'reply'>) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const asking = run.question !== null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    await reply(message);
    setText('');
    setSending(false);
  };

  return (
    <form className="reply" onSubmit={submit}>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={asking ? 'Your answer' : 'Add a note for the assistant'}
        maxLength={1_000}
        aria-label={asking ? 'Answer the question' : 'Message the assistant'}
      />
      <button type="submit" disabled={sending || !text.trim()}>
        {asking ? 'Answer' : 'Send'}
      </button>
    </form>
  );
}

export function RunMessage({ run, preset, isActive, reply, cancel }: RunMessageProps) {
  const terminal = isTerminalStatus(run.status);
  return (
    <>
      <div className="bubble bubble-user">
        {preset ? <span className="bubble-tag">{preset.label}</span> : null}
        {run.request}
      </div>

      <div className="bubble bubble-assistant">
        <div className="status-line">
          <span className={`status status-${run.status}`}>{statusLabel(run.status)}</span>
          {run.charged !== null ? <span className="muted">{run.charged} credits used</span> : null}
        </div>

        {!terminal || run.status !== 'completed' ? <ProgressTimeline entries={run.timeline} /> : null}

        {run.question ? <p className="question">{run.question}</p> : null}

        {run.status === 'completed' && run.result ? (
          <ResultCard preset={preset} result={run.result} />
        ) : null}

        {run.status === 'failed' || run.status === 'cancelled' ? (
          <p className="muted">{run.message ?? 'Nothing was booked or changed.'}</p>
        ) : null}

        {isActive ? (
          <>
            <ReplyForm run={run} reply={reply} />
            <div className="run-actions">
              <WatchPanel streamUrl={run.streamUrl} streamToken={run.streamToken} />
              <button type="button" className="link danger" disabled={run.status === 'cancelling'} onClick={() => void cancel()}>
                Stop
              </button>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
