import { useMemo } from 'react';
import type { RunnerState } from '@/client/runner-machine';
import { statusLabel } from '@/client/status-label';

type RunTelemetryProps = {
  state: RunnerState;
};

export function RunTelemetry({ state }: RunTelemetryProps) {
  const formattedOutput = useMemo(
    () => (state.task?.output ? JSON.stringify(state.task.output, null, 2) : null),
    [state.task?.output],
  );

  return (
    <section
      className={`telemetry status-${state.status ?? 'idle'}`}
      aria-live="polite"
    >
      <div className="telemetry-heading">
        <div>
          <span className="telemetry-dot" aria-hidden="true" />
          <strong>{statusLabel(state, false)}</strong>
        </div>
        <span>{state.task?.steps ?? 0} STEPS</span>
      </div>

      <dl>
        <div>
          <dt>Task ID</dt>
          <dd>{state.runId ?? '—'}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{state.status ?? state.phase}</dd>
        </div>
        <div>
          <dt>Result</dt>
          <dd>
            {state.task?.succeeded === true
              ? 'Succeeded'
              : state.task?.succeeded === false
                ? 'Failed'
                : 'Pending'}
          </dd>
        </div>
      </dl>

      {state.error ? <p className="error-message">{state.error}</p> : null}
      {formattedOutput ? (
        <div className="output">
          <div>
            <span>STRUCTURED OUTPUT</span>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(formattedOutput)}
            >
              COPY
            </button>
          </div>
          <pre>{formattedOutput}</pre>
        </div>
      ) : (
        <p className="empty-output">
          Structured output appears here when the task finishes.
        </p>
      )}
    </section>
  );
}
