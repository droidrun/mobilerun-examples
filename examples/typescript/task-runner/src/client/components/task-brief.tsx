import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { RunnerState } from '@/client/runner-machine';
import { TASK_PRESETS, type TaskPreset } from '@/client/task-presets';
import { useDevices } from '@/client/use-devices';
import type { RunTaskRequest } from '@/shared/contracts';
import { RunTelemetry } from './run-telemetry';

type TaskBriefProps = {
  state: RunnerState;
  run: (input: RunTaskRequest) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
};

export function TaskBrief({ state, run, cancel, reset }: TaskBriefProps) {
  const { items: devices, loading, error: devicesError } = useDevices();
  const [selectedPreset, setSelectedPreset] = useState('device');
  const [task, setTask] = useState<string>(TASK_PRESETS[0].task);
  const [deviceId, setDeviceId] = useState('');
  const [maxSteps, setMaxSteps] = useState(30);
  const active = ['starting', 'active', 'cancelling'].includes(state.phase);
  const terminal = state.phase === 'terminal';

  useEffect(() => {
    if (!deviceId && devices[0]) setDeviceId(devices[0].id);
  }, [deviceId, devices]);

  const choosePreset = (preset: TaskPreset) => {
    if (active) return;
    setSelectedPreset(preset.id);
    setTask(preset.task);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run({
      task,
      deviceId,
      maxSteps,
    });
  };

  return (
    <div className="runner-column">
      <div className="panel-label">
        <span>TASK BRIEF</span>
        <span>SERVER-SIDE SDK</span>
      </div>

      <div className="preset-grid">
        {TASK_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={selectedPreset === preset.id ? 'preset selected' : 'preset'}
            disabled={active}
            onClick={() => choosePreset(preset)}
          >
            <span>{preset.eyebrow}</span>
            <strong>{preset.title}</strong>
          </button>
        ))}
      </div>

      <form className="run-form" onSubmit={submit}>
        <label className="field">
          <span>Instruction</span>
          <textarea
            value={task}
            disabled={active}
            onChange={(event) => {
              setTask(event.target.value);
              setSelectedPreset('custom');
            }}
            placeholder="Tell the agent what to do on the device…"
            maxLength={8_000}
            rows={6}
          />
          <small>{task.length.toLocaleString()} / 8,000 characters</small>
        </label>

        <div className="field-row">
          <label className="field">
            <span>Device</span>
            <select
              value={deviceId}
              disabled={active}
              onChange={(event) => setDeviceId(event.target.value)}
              required
            >
              <option value="">
                {loading ? 'Loading devices…' : 'Select a device'}
              </option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} · {device.state}
                </option>
              ))}
            </select>
            {devicesError ? <small>{devicesError}</small> : null}
          </label>
          <label className="field steps-field">
            <span>Step limit</span>
            <input
              type="number"
              min={1}
              max={100}
              value={maxSteps}
              disabled={active}
              onChange={(event) => setMaxSteps(event.currentTarget.valueAsNumber)}
            />
          </label>
        </div>

        <div className="actions">
          {!active && !terminal ? (
            <button
              className="primary-action"
              type="submit"
              disabled={!task.trim() || !deviceId || !Number.isInteger(maxSteps)}
            >
              <span>RUN TASK</span>
              <span aria-hidden="true">↗</span>
            </button>
          ) : null}
          {active ? (
            <button
              className="danger-action"
              type="button"
              disabled={state.phase !== 'active'}
              onClick={() => void cancel()}
            >
              {state.phase === 'cancelling' ? 'STOPPING…' : 'CANCEL TASK'}
            </button>
          ) : null}
          {terminal || state.phase === 'error' ? (
            <button className="secondary-action" type="button" onClick={reset}>
              NEW TASK
            </button>
          ) : null}
        </div>
      </form>

      <RunTelemetry state={state} />
    </div>
  );
}
