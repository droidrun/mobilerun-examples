import { randomUUID } from 'node:crypto';
import {
  isTerminalStatus,
  type RunView,
  type SessionView,
  type StartRunRequest,
} from '@/shared/contracts';
import type { AssistantDeps } from './assistant-deps';
import {
  messageFor,
  publicPersona,
  systemPromptFor,
  taskFor,
  type AssistantConfig,
} from './assistant-config';
import { ApiProblem, isDefiniteRejection, statusOf } from './errors';
import type { Ledger, RunRecord } from './ledger';
import { outputSchemaFor, publicPresets, type Preset } from './presets';
import {
  createRunWatcher,
  note,
  type LiveRun,
  type Schedule,
} from './run-watcher';

export type AssistantServiceOptions = {
  ledger: Ledger;
  /** null when no API key is configured: the UI loads, runs cannot start. */
  deps: AssistantDeps | null;
  assistant: AssistantConfig;
  presets: ReadonlyArray<Preset>;
  deviceIds: ReadonlyArray<string>;
  reservePerRun: number;
  pollIntervalMs: number;
  /** Test seams for the watcher. */
  schedule?: Schedule;
  now?: () => number;
};

export type AssistantService = {
  readonly sdkConfigured: boolean;
  session: (userId: string) => SessionView;
  start: (userId: string, input: StartRunRequest) => Promise<RunView>;
  get: (userId: string, runId: string) => RunView;
  sendMessage: (userId: string, runId: string, message: string) => Promise<RunView>;
  cancel: (userId: string, runId: string) => Promise<RunView>;
  /** Re-attach watchers and phone locks for runs left open by a restart (single process). */
  resume: () => void;
};

const RECENT_RUNS = 20;
const RAW_OUTPUT_LIMIT = 4_000;

export function createAssistantService(
  options: AssistantServiceOptions,
): AssistantService {
  const { ledger, deps, assistant, deviceIds, reservePerRun } = options;
  const busyDevices = new Set<string>();
  const live = new Map<string, LiveRun>();
  const watcher = deps
    ? createRunWatcher({
        ledger,
        deps,
        busyDevices,
        live,
        executionTimeoutSeconds: assistant.executionTimeout,
        pollIntervalMs: options.pollIntervalMs,
        schedule: options.schedule,
        now: options.now,
      })
    : null;

  const requireDeps = (): AssistantDeps => {
    if (!deps) {
      throw new ApiProblem(
        503,
        'missing_api_key',
        'The assistant is not connected yet. Set MOBILERUN_CLOUD_API_KEY on the server.',
      );
    }
    return deps;
  };

  const view = (run: RunRecord): RunView => {
    const entry = live.get(run.id);
    const preset = options.presets.find((item) => item.id === run.presetId);
    const parsed =
      run.output !== null && preset ? preset.output.safeParse(run.output) : null;
    return {
      id: run.id,
      presetId: run.presetId,
      request: run.request,
      status: run.status,
      steps: run.steps,
      timeline: entry?.timeline ?? run.timeline ?? [],
      result: parsed?.success ? parsed.data : null,
      rawOutput:
        run.output !== null && !parsed?.success
          ? JSON.stringify(run.output, null, 2).slice(0, RAW_OUTPUT_LIMIT)
          : null,
      message: run.message,
      error:
        entry?.error ??
        (run.status === 'unknown'
          ? "We couldn't confirm that your request started. We're checking."
          : null),
      charged: run.charged,
      balance: ledger.balance(run.userId),
      createdAt: run.createdAt,
    };
  };

  const owned = (userId: string, runId: string): RunRecord => {
    const run = ledger.getRun(userId, runId);
    if (!run) throw new ApiProblem(404, 'run_not_found', 'Run not found.');
    return run;
  };

  /** The task may exist but we cannot tell: keep the reservation and the phone. */
  const markUnknown = (runId: string): void => {
    try {
      ledger.updateProgress(runId, { status: 'unknown' });
    } catch (error) {
      console.error('could not mark run unknown', runId, error);
    }
  };

  return {
    sdkConfigured: deps !== null,

    session(userId) {
      return {
        persona: publicPersona(assistant),
        presets: publicPresets(options.presets),
        balance: ledger.balance(userId),
        reservePerRun,
        sdkConfigured: deps !== null,
        deviceCount: deviceIds.length,
        runs: ledger
          .listRuns(userId, RECENT_RUNS)
          .reverse()
          .map((run) => view(run)),
      };
    },

    async start(userId, input) {
      const api = requireDeps();
      const preset = options.presets.find((item) => item.id === input.presetId);
      if (!preset) {
        throw new ApiProblem(400, 'unknown_preset', 'Choose one of the listed requests.');
      }
      if (deviceIds.length === 0) {
        throw new ApiProblem(503, 'no_devices', 'No phones are configured. Set DEVICE_IDS on the server.');
      }
      // One active run per phone. Busy phones are rejected with 409 instead of
      // queued, so the user gets an immediate answer and the ledger stays simple.
      const deviceId = deviceIds.find((id) => !busyDevices.has(id));
      if (!deviceId) {
        throw new ApiProblem(409, 'device_busy', 'Every phone is busy right now. Try again in a minute.');
      }
      busyDevices.add(deviceId);
      const release = () => busyDevices.delete(deviceId);

      const runId = randomUUID();
      let outcome;
      try {
        outcome = ledger.reserve({
          userId,
          runId,
          deviceId,
          presetId: preset.id,
          request: input.message,
          amount: reservePerRun,
        });
      } catch (error) {
        release();
        throw error;
      }
      if (outcome !== 'ok') {
        release();
        throw outcome === 'run_active'
          ? new ApiProblem(409, 'run_active', 'You already have a request in progress. Wait for it to finish or stop it.')
          : new ApiProblem(
              402,
              'insufficient_credits',
              `Not enough credits: a request reserves ${reservePerRun}, you have ${ledger.balance(userId)}.`,
            );
      }

      let taskId: string;
      try {
        ({ taskId } = await api.startTask({
          deviceId,
          task: taskFor(preset.instruction, input.message),
          systemPrompt: systemPromptFor(assistant),
          outputSchema: outputSchemaFor(preset),
          maxSteps: assistant.maxSteps,
          executionTimeout: assistant.executionTimeout,
          ...(assistant.llmModel ? { llmModel: assistant.llmModel } : {}),
        }));
      } catch (error) {
        if (isDefiniteRejection(error)) {
          // The API said no: the task does not exist, so refund everything.
          try {
            ledger.settle(runId, { status: 'failed', creditsUsed: 0 });
          } finally {
            release();
          }
          throw error;
        }
        // Timeout, 5xx or network failure: the task may exist. Keep the
        // reservation and the phone; the watcher settles it at the deadline.
        console.warn(`start of run ${runId} is unconfirmed`, error);
        markUnknown(runId);
        watcher?.watch(runId);
        return view(owned(userId, runId));
      }

      try {
        ledger.attachTask(runId, taskId);
      } catch (error) {
        // The task exists but the database write failed. Keep everything and
        // let the watcher record the task id and reconcile.
        console.error('could not record the task id', runId, error);
        markUnknown(runId);
        watcher?.watch(runId, taskId);
        return view(owned(userId, runId));
      }

      note(live, runId, 'status', 'Started');
      watcher?.watch(runId);
      return view(owned(userId, runId));
    },

    // The watcher is the only thing that talks to the API for progress; this
    // reads what it recorded.
    get: (userId, runId) => view(owned(userId, runId)),

    async sendMessage(userId, runId, message) {
      const api = requireDeps();
      const run = owned(userId, runId);
      if (isTerminalStatus(run.status)) {
        throw new ApiProblem(409, 'run_finished', 'This request has already finished.');
      }
      if (!run.taskId) {
        throw new ApiProblem(409, 'run_starting', 'The request is still starting.');
      }
      const sent = await api.sendMessage(run.taskId, messageFor(message));
      if (!sent) {
        throw new ApiProblem(409, 'message_not_sent', "Your note couldn't be delivered. Try again in a moment.");
      }
      note(live, run.id, 'user', message);
      return view(owned(userId, runId));
    },

    async cancel(userId, runId) {
      const api = requireDeps();
      const run = owned(userId, runId);
      if (isTerminalStatus(run.status) || !run.taskId) return view(run);
      try {
        await api.stopTask(run.taskId);
      } catch (error) {
        // 409: the task already reached a terminal state; the watcher settles it.
        if (statusOf(error) !== 409) throw error;
      }
      ledger.updateProgress(runId, { status: 'cancelling' });
      return view(owned(userId, runId));
    },

    resume() {
      for (const run of ledger.openRuns()) {
        busyDevices.add(run.deviceId);
        if (!run.taskId) markUnknown(run.id);
        watcher?.watch(run.id);
      }
    },
  };
}
