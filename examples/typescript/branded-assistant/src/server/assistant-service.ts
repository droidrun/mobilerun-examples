import { randomUUID } from 'node:crypto';
import {
  isTerminalStatus,
  type RunStatus,
  type RunView,
  type SessionView,
  type StartRunRequest,
  type TimelineEntry,
} from '@/shared/contracts';
import {
  outputSchemaFor,
  publicPersona,
  publicPresets,
  systemPromptFor,
  taskFor,
  type AssistantConfig,
} from './assistant-config';
import { ApiProblem, UpstreamError, problemFromUpstream } from './errors';
import type { Ledger, RunRow } from './ledger';
import {
  describeAgentEvent,
  looksLikeQuestion,
  mapStatus,
  type UpstreamStatus,
} from './progress';

export type StartTaskInput = {
  deviceId: string;
  task: string;
  systemPrompt: string;
  outputSchema: Record<string, unknown>;
  maxSteps: number;
  executionTimeout: number;
  llmModel?: string;
};

export type TaskStatusRecord = {
  status: UpstreamStatus;
  succeeded?: boolean | null;
  steps?: number | null;
  message?: string | null;
  lastResponse?: Record<string, unknown> | null;
};

export type TaskResultRecord = {
  status: UpstreamStatus;
  succeeded?: boolean | null;
  steps?: number | null;
  message?: string | null;
  output?: Record<string, unknown> | null;
  creditsUsed?: number | null;
};

export type StreamCredentials = { streamUrl: string; streamToken: string };

/** Everything the service needs from Mobilerun; the adapter is the only SDK user. */
export interface AssistantDeps {
  startTask: (input: StartTaskInput) => Promise<{ taskId: string }>;
  getStatus: (taskId: string) => Promise<TaskStatusRecord>;
  retrieveTask: (taskId: string) => Promise<TaskResultRecord>;
  sendMessage: (taskId: string, message: string) => Promise<void>;
  stopTask: (taskId: string) => Promise<void>;
  getStream: (deviceId: string) => Promise<StreamCredentials | undefined>;
}

export type AssistantServiceOptions = {
  ledger: Ledger;
  /** null when no API key is configured: the UI loads, runs cannot start. */
  deps: AssistantDeps | null;
  assistant: AssistantConfig;
  deviceIds: ReadonlyArray<string>;
  reservePerRun: number;
  /** Background settlement poll; 0 disables it (tests drive `get` instead). */
  pollIntervalMs: number;
};

export type AssistantService = {
  session: (userId: string) => SessionView;
  start: (userId: string, input: StartRunRequest) => Promise<RunView>;
  get: (userId: string, runId: string) => Promise<RunView>;
  list: (userId: string) => Array<RunView>;
  sendMessage: (
    userId: string,
    runId: string,
    message: string,
  ) => Promise<RunView>;
  cancel: (userId: string, runId: string) => Promise<RunView>;
  /** Re-attach watchers and device locks for runs left open by a restart. */
  resume: () => void;
  stop: () => void;
  readonly sdkConfigured: boolean;
};

type LiveRun = {
  timeline: Array<TimelineEntry>;
  lastAgentText: string | null;
  lastSteps: number;
  question: string | null;
  stream?: StreamCredentials;
};

const MAX_TIMELINE = 60;
const RECENT_RUNS = 20;

export function createAssistantService(
  options: AssistantServiceOptions,
): AssistantService {
  const { ledger, deps, assistant, deviceIds, reservePerRun } = options;
  const busyDevices = new Set<string>();
  const live = new Map<string, LiveRun>();
  const syncing = new Map<string, Promise<void>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;

  const requireDeps = (): AssistantDeps => {
    if (!deps) {
      throw new ApiProblem(
        503,
        'missing_api_key',
        'The assistant is not connected yet. Set MOBILERUN_API_KEY on the server.',
      );
    }
    return deps;
  };

  /** Run an upstream call, rendering API errors as returned. */
  const upstream = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      if (error instanceof UpstreamError) {
        console.error('upstream call failed', error.status, error.message);
        throw problemFromUpstream(error);
      }
      throw error;
    }
  };

  const liveFor = (runId: string): LiveRun => {
    let entry = live.get(runId);
    if (!entry) {
      entry = { timeline: [], lastAgentText: null, lastSteps: 0, question: null };
      live.set(runId, entry);
    }
    return entry;
  };

  const note = (
    runId: string,
    kind: TimelineEntry['kind'],
    text: string,
  ): void => {
    const entry = liveFor(runId);
    entry.timeline.push({ at: new Date().toISOString(), kind, text });
    if (entry.timeline.length > MAX_TIMELINE) entry.timeline.shift();
  };

  const view = (row: RunRow): RunView => {
    const entry = live.get(row.id);
    const status = row.status;
    const terminal = isTerminalStatus(status);
    return {
      id: row.id,
      presetId: row.preset_id,
      request: row.request,
      status,
      steps: row.steps,
      timeline: entry?.timeline ?? [],
      question: !terminal ? (entry?.question ?? null) : null,
      result: row.output
        ? (JSON.parse(row.output) as Record<string, unknown>)
        : null,
      message: row.message,
      reserved: row.reserved,
      charged: row.settled,
      balance: ledger.balance(row.user_id),
      createdAt: row.created_at,
      ...(!terminal && entry?.stream ? entry.stream : {}),
    };
  };

  const finish = (row: RunRow): void => {
    busyDevices.delete(row.device_id);
    const entry = live.get(row.id);
    if (entry) delete entry.stream;
    const timer = timers.get(row.id);
    if (timer) clearTimeout(timer);
    timers.delete(row.id);
  };

  const sync = async (runId: string): Promise<void> => {
    const row = ledger.getRunById(runId);
    if (!row || row.settled !== null || !row.task_id || !deps) return;
    const taskId = row.task_id;
    const entry = liveFor(runId);

    const state = await deps.getStatus(taskId);
    const status = mapStatus(state.status, state.succeeded);
    const text = describeAgentEvent(state.lastResponse);
    const steps = state.steps ?? row.steps ?? 0;

    if (text && text !== entry.lastAgentText) {
      note(runId, 'agent', text);
      entry.lastAgentText = text;
    } else if (!text && steps > entry.lastSteps) {
      note(runId, 'status', `Step ${steps}`);
    }
    entry.lastSteps = Math.max(entry.lastSteps, steps);
    entry.question = status === 'running' && looksLikeQuestion(text) ? text : null;

    if (!isTerminalStatus(status)) {
      ledger.updateProgress(runId, { status, steps });
      if (!entry.stream) {
        entry.stream = await deps.getStream(row.device_id).catch(() => undefined);
      }
      return;
    }

    const result = await deps.retrieveTask(taskId);
    const settled = ledger.settle(runId, {
      status,
      creditsUsed: result.creditsUsed ?? (status === 'completed' ? row.reserved : 0),
      output: result.output ?? null,
      message: result.message ?? state.message ?? null,
      steps: result.steps ?? steps,
    });
    note(
      runId,
      'status',
      status === 'completed'
        ? 'Finished'
        : status === 'cancelled'
          ? 'Cancelled'
          : 'Stopped before finishing',
    );
    if (settled || ledger.getRunById(runId)?.settled !== null) finish(row);
  };

  const syncOnce = (runId: string): Promise<void> => {
    const running = syncing.get(runId);
    if (running) return running;
    const next = sync(runId).finally(() => syncing.delete(runId));
    syncing.set(runId, next);
    return next;
  };

  const watch = (runId: string): void => {
    if (options.pollIntervalMs <= 0 || stopped) return;
    const timer = setTimeout(async () => {
      timers.delete(runId);
      try {
        await syncOnce(runId);
      } catch (error) {
        console.error('background sync failed', error);
      }
      const row = ledger.getRunById(runId);
      if (row && row.settled === null && !stopped) watch(runId);
    }, options.pollIntervalMs);
    timer.unref?.();
    timers.set(runId, timer);
  };

  const owned = (userId: string, runId: string): RunRow => {
    const row = ledger.getRun(userId, runId);
    if (!row) throw new ApiProblem(404, 'run_not_found', 'Run not found.');
    return row;
  };

  const refreshed = async (userId: string, runId: string): Promise<RunView> => {
    const row = owned(userId, runId);
    if (row.settled === null) {
      await syncOnce(runId).catch((error: unknown) => {
        // Keep serving the last known state; the next poll retries.
        console.error('sync failed', error);
      });
    }
    return view(owned(userId, runId));
  };

  const list = (userId: string): Array<RunView> =>
    ledger
      .listRuns(userId, RECENT_RUNS)
      .reverse()
      .map((row) => view(row));

  return {
    sdkConfigured: deps !== null,

    session(userId) {
      return {
        persona: publicPersona(assistant),
        presets: publicPresets(assistant),
        balance: ledger.balance(userId),
        reservePerRun,
        sdkConfigured: deps !== null,
        deviceCount: deviceIds.length,
        runs: list(userId),
      };
    },

    async start(userId, input) {
      const api = requireDeps();
      const preset = assistant.presets.find((item) => item.id === input.presetId);
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

      const runId = randomUUID();
      try {
        const reservation = ledger.reserve({
          userId,
          runId,
          deviceId,
          presetId: preset.id,
          request: input.message,
          amount: reservePerRun,
        });
        if (!reservation.ok) {
          throw new ApiProblem(
            402,
            'insufficient_credits',
            `Not enough credits: a request reserves ${reservePerRun}, you have ${reservation.balance}.`,
          );
        }

        try {
          const { taskId } = await upstream(() =>
            api.startTask({
              deviceId,
              task: taskFor(preset, input.message),
              systemPrompt: systemPromptFor(assistant),
              outputSchema: outputSchemaFor(preset),
              maxSteps: assistant.maxSteps,
              executionTimeout: assistant.executionTimeout,
              ...(assistant.llmModel ? { llmModel: assistant.llmModel } : {}),
            }),
          );
          ledger.attachTask(runId, taskId);
        } catch (error) {
          // The task never existed: give the whole reservation back.
          ledger.settle(runId, { status: 'failed', creditsUsed: 0 });
          throw error;
        }
      } catch (error) {
        busyDevices.delete(deviceId);
        throw error;
      }

      note(runId, 'status', 'Started');
      const entry = liveFor(runId);
      entry.stream = await api.getStream(deviceId).catch(() => undefined);
      watch(runId);
      return view(owned(userId, runId));
    },

    get: refreshed,

    list,

    async sendMessage(userId, runId, message) {
      const api = requireDeps();
      const row = owned(userId, runId);
      if (isTerminalStatus(row.status)) {
        throw new ApiProblem(409, 'run_finished', 'This request has already finished.');
      }
      if (!row.task_id) {
        throw new ApiProblem(409, 'run_starting', 'The request is still starting.');
      }
      const taskId = row.task_id;
      await upstream(() => api.sendMessage(taskId, message));
      note(runId, 'user', message);
      liveFor(runId).question = null;
      return view(owned(userId, runId));
    },

    async cancel(userId, runId) {
      const api = requireDeps();
      const row = owned(userId, runId);
      if (isTerminalStatus(row.status) || !row.task_id) return view(row);
      const taskId = row.task_id;
      try {
        await upstream(() => api.stopTask(taskId));
      } catch (error) {
        // 409: the task already reached a terminal state; settle it below.
        if (!(error instanceof ApiProblem && error.status === 409)) throw error;
      }
      ledger.updateProgress(runId, { status: 'cancelling' });
      return refreshed(userId, runId);
    },

    resume() {
      for (const row of ledger.openRuns()) {
        if (row.task_id) {
          busyDevices.add(row.device_id);
          watch(row.id);
        } else {
          // The process died between reserving and creating a task.
          ledger.settle(row.id, { status: 'failed', creditsUsed: 0 });
        }
      }
    },

    stop() {
      stopped = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
