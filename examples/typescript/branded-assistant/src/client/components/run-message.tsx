import { useState, type FormEvent } from 'react';
import { isTerminalStatus, type PublicPreset, type RunView } from '@/shared/contracts';
import { statusLabel } from '../status-label';
import { ProgressTimeline } from './progress-timeline';
import { ResultCard } from './result-card';

type RunMessageProps = {
  run: RunView;
  preset: PublicPreset | undefined;
  isActive: boolean;
  reply: (message: string) => Promise<boolean>;
  cancel: () => Promise<void>;
};

function ReplyForm({ reply }: Pick<RunMessageProps, 'reply'>) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    // Keep the text when the note was not delivered, so nothing is lost.
    if (await reply(message)) setText('');
    setSending(false);
  };

  return (
    <form className="reply" onSubmit={submit}>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Send a note to your assistant"
        maxLength={1_000}
        aria-label="Send a note to your assistant"
      />
      <button type="submit" disabled={sending || !text.trim()}>
        Send
      </button>
    </form>
  );
}

export function RunMessage({ run, preset, isActive, reply, cancel }: RunMessageProps) {
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

        {run.error ? <p className="muted" role="status">{run.error}</p> : null}

        {run.status !== 'completed' ? <ProgressTimeline entries={run.timeline} /> : null}

        {run.status === 'completed' ? (
          <ResultCard preset={preset} result={run.result} rawOutput={run.rawOutput} />
        ) : null}

        {run.status === 'failed' || run.status === 'cancelled' ? (
          <p className="muted">{run.message ?? 'Nothing was booked or changed.'}</p>
        ) : null}

        {isActive && !isTerminalStatus(run.status) ? (
          <>
            {run.status !== 'unknown' ? <ReplyForm reply={reply} /> : null}
            <div className="run-actions">
              <span />
              {run.status !== 'unknown' ? (
                <button
                  type="button"
                  className="link danger"
                  disabled={run.status === 'cancelling'}
                  onClick={() => void cancel()}
                >
                  Stop
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
