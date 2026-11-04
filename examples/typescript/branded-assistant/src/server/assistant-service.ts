import type Mobilerun from '@mobilerun/sdk';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { isTerminal, type RunStatus, type RunView, type TimelineEntry } from '@/shared/contracts';
import * as catalog from './assistant';
import type { Ledger, RunRecord, Settlement } from './ledger';

const { assistant, presets } = catalog;
const DEADLINE_MARGIN_MS = 60_000;
const MAX_TIMELINE = 60;
const UNREACHABLE = 'Your assistant is hard to reach right now. Retrying.';
const UNCONFIRMED = "We couldn't confirm that your request started. We're checking.";
const FINAL: Partial<Record<RunStatus, string>> =
  { completed: 'Finished', cancelled: 'Cancelled', failed: 'Stopped before finishing' };
/** Mobilerun task statuses; prepared, queued and created read as `starting`. */
const STATUS: Record<string, RunStatus> = { running: 'running', cancelling: 'cancelling',
  completed: 'completed', failed: 'failed', cancelled: 'cancelled' };

/** A refusal of this server's own: a stable code, an HTTP status, text a user may read. */
export class AssistantError extends Error {
  constructor(readonly code: string, readonly status: ContentfulStatusCode, message: string) {
    super(message);
  }
}
const statusOf = (error: unknown) => (error as { status?: unknown } | null)?.status;
/** The API definitely refused: a 4xx other than 408. Timeouts, 5xx and network errors may not. */
const isRejection = (error: unknown, status = statusOf(error)) =>
  typeof status === 'number' && status >= 400 && status < 500 && status !== 408;

type Options = {
  /** null without an API key: the page loads, runs cannot start. */
  client: Mobilerun | null;
  ledger: Ledger;
  deviceIds: ReadonlyArray<string>;
  reservePerRun: number;
  pollIntervalMs: number;
  // Seams for tests.
  schedule?: (tick: () => Promise<void>, delayMs: number) => void;
  now?: () => number;
};
export type AssistantService = ReturnType<typeof createAssistantService>;

/** Runs, notes and settlement, and every @mobilerun/sdk call this example makes. */
export function createAssistantService({
  client,
  ledger,
  deviceIds,
  reservePerRun,
  pollIntervalMs,
  schedule = (tick, ms) => void setTimeout(tick, ms).unref(),
  now = Date.now,
}: Options) {
  const deadlineMs = assistant.executionTimeout * 1_000 + DEADLINE_MARGIN_MS;
  const busyPhones = new Set<string>();
  /** Active runs only; the timeline is saved when the run settles. */
  const live = new Map<string, { timeline: Array<TimelineEntry>; steps: number; error?: string }>();
  /** Task ids the database failed to record after the API accepted the task. */
  const pendingTaskIds = new Map<string, string>();

  // api-app refuses every run route without a key, so the SDK calls below always have a client.
  const tasks = () => {
    if (!client) throw new Error('No Mobilerun client: MOBILERUN_CLOUD_API_KEY is not set.');
    return client.tasks;
  };
  const liveRun = (runId: string) => {
    if (!live.has(runId)) live.set(runId, { timeline: [], steps: 0 });
    return live.get(runId)!;
  };
  const note = (runId: string, kind: TimelineEntry['kind'], text: string) => {
    const { timeline } = liveRun(runId);
    timeline.push({ at: new Date(now()).toISOString(), kind, text });
    if (timeline.length > MAX_TIMELINE) timeline.shift();
  };
  const owned = (userId: string, runId: string) => {
    const run = ledger.run(runId);
    // Someone else's run answers exactly like an unknown one.
    if (run?.userId !== userId) throw new AssistantError('run_not_found', 404, 'Run not found.');
    return run;
  };
  /** The task may exist but we cannot tell: the reservation and the phone stay held. */
  const markUnknown = (runId: string) => {
    try {
      ledger.progress(runId, 'unknown');
    } catch (error) {
      console.error('could not mark run unknown', runId, error);
    }
  };

  const view = (run: RunRecord): RunView => {
    const { id, presetId, request, status, steps, message, charged, createdAt, output } = run;
    const preset = presets.find((item) => item.id === presetId);
    const parsed = output == null ? undefined : preset?.output.safeParse(output);
    const unreadable = output != null && !parsed?.success;
    return {
      id, presetId, request, status, steps, message, charged, createdAt,
      timeline: live.get(id)?.timeline ?? run.timeline ?? [],
      result: preset && parsed?.success ? catalog.resultOf(preset, parsed.data) : null,
      rawOutput: unreadable ? JSON.stringify(output, null, 2).slice(0, 4_000) : null,
      error: live.get(id)?.error ?? (status === 'unknown' ? UNCONFIRMED : null),
      balance: ledger.balance(run.userId),
    };
  };

  // The watcher: the one polling path. It moves runs forward, settles credits, frees phones
  // and stops runs past their deadline. Routes only read what it recorded.
  const settle = (run: RunRecord, settlement: Settlement) => {
    note(run.id, 'status', FINAL[settlement.status]!);
    ledger.settle(run.id, { ...settlement, timeline: live.get(run.id)?.timeline });
    busyPhones.delete(run.deviceId);
    live.delete(run.id);
    pendingTaskIds.delete(run.id);
  };

  const sync = async (run: RunRecord) => {
    const taskId = run.taskId ?? pendingTaskIds.get(run.id);
    if (taskId && !run.taskId) ledger.attachTask(run.id, taskId);
    if (now() > Date.parse(run.createdAt) + deadlineMs) {
      console.warn(`run ${run.id} passed its deadline; stopping and settling`);
      if (taskId) await tasks().stop(taskId).catch(() => {});
      const result = taskId ? await tasks().retrieve(taskId).catch(() => null) : null;
      const creditsUsed = result?.task.creditsUsed ?? null;
      const message = 'The request took too long and was stopped.';
      return settle(run, { status: 'failed', creditsUsed, message });
    }
    if (!taskId) return; // an unconfirmed start waits for its deadline

    const entry = liveRun(run.id);
    let state: Mobilerun.TaskGetStatusResponse;
    let result: Mobilerun.TaskRetrieveResponse | undefined;
    try {
      state = await tasks().getStatus(taskId);
      if (isTerminal(STATUS[state.status] ?? 'starting')) result = await tasks().retrieve(taskId);
    } catch (error) {
      console.error('task status failed', run.id, error);
      entry.error = UNREACHABLE;
      return;
    }
    entry.error = undefined;
    // The agent can finish a task and still report that it did not succeed.
    const failed = state.status === 'completed' && state.succeeded === false;
    const status = failed ? 'failed' : (STATUS[state.status] ?? 'starting');
    const steps = state.steps ?? run.steps ?? 0;
    if (steps > entry.steps) {
      entry.steps = steps;
      note(run.id, 'status', `Step ${steps}`);
    }
    if (!result) return ledger.progress(run.id, status, steps);
    const { task } = result;
    const message = task.message ?? state.message ?? null;
    const usage = { creditsUsed: task.creditsUsed ?? null, steps: task.steps ?? steps };
    settle(run, { status, output: task.output, message, ...usage });
  };

  const watch = (runId: string) => {
    const tick = async () => {
      const run = ledger.run(runId);
      if (!run || run.charged !== null) return;
      await sync(run).catch((error: unknown) => console.error('run sync failed', runId, error));
      if (ledger.run(runId)?.charged === null) schedule(tick, pollIntervalMs);
    };
    schedule(tick, pollIntervalMs);
  };

  return {
    configured: client !== null,

    session(userId: string) {
      const run = ledger.latest(userId);
      return {
        persona: { name: assistant.name, role: assistant.role },
        presets: presets.map(({ id, label, hint }) => ({ id, label, hint })),
        balance: ledger.balance(userId),
        reservePerRun,
        run: run ? view(run) : null,
      };
    },

    async start(userId: string, presetId: string, request: string) {
      const preset = presets.find((item) => item.id === presetId);
      if (!preset) throw new AssistantError('unknown_preset', 400, 'Choose one of the requests.');
      if (!deviceIds.length) {
        throw new AssistantError('no_devices', 503, 'No phones are set up yet.');
      }
      // One run per phone: a busy pool answers at once instead of queueing.
      const deviceId = deviceIds.find((id) => !busyPhones.has(id));
      if (!deviceId) {
        throw new AssistantError('device_busy', 409, 'Every phone is busy. Try again in a minute.');
      }
      const runId = crypto.randomUUID();
      busyPhones.add(deviceId);
      let outcome: ReturnType<Ledger['reserve']> | undefined;
      try {
        const reservation = { userId, runId, deviceId, presetId, request, amount: reservePerRun };
        outcome = ledger.reserve(reservation);
      } finally {
        if (outcome !== 'ok') busyPhones.delete(deviceId);
      }
      if (outcome === 'run_active') {
        throw new AssistantError('run_active', 409, 'You already have a request going.');
      }
      if (outcome === 'insufficient') {
        const message = `A request holds ${reservePerRun}; you have ${ledger.balance(userId)}.`;
        throw new AssistantError('insufficient_credits', 402, message);
      }

      let taskId: string | undefined;
      try {
        const { llmModel, maxSteps, executionTimeout } = assistant;
        const params = {
          deviceId,
          task: catalog.taskFor(preset, request),
          systemPrompt: catalog.systemPrompt,
          outputSchema: catalog.outputSchemaFor(preset),
          maxSteps,
          executionTimeout,
          ...(llmModel ? { llmModel } : {}),
        };
        // No SDK retries: a retried start could create the task twice.
        taskId = (await tasks().run(params, { maxRetries: 0 })).id;
        ledger.attachTask(runId, taskId);
        note(runId, 'status', 'Started');
      } catch (error) {
        if (!taskId && isRejection(error)) {
          // The API said no, so no task exists: refund everything.
          try {
            ledger.settle(runId, { status: 'failed', creditsUsed: 0 });
          } finally {
            busyPhones.delete(deviceId);
          }
          throw error;
        }
        // Unclear (timeout, 5xx, network) or the task id was not saved: keep the reservation
        // and the phone; the watcher reconciles the run or settles it at its deadline.
        console.warn(`start of run ${runId} is unconfirmed`, error);
        if (taskId) pendingTaskIds.set(runId, taskId);
        markUnknown(runId);
      }
      watch(runId);
      return view(owned(userId, runId));
    },

    get: (userId: string, runId: string) => view(owned(userId, runId)),

    async sendNote(userId: string, runId: string, text: string) {
      const run = owned(userId, runId);
      if (isTerminal(run.status)) {
        throw new AssistantError('run_finished', 409, 'This request has already finished.');
      }
      if (!run.taskId) {
        throw new AssistantError('run_starting', 409, 'Your request is still starting.');
      }
      const message = catalog.noteFor(text);
      const { sent } = await tasks().sendMessage(run.taskId, { message });
      if (!sent) {
        const notSent = "Your note couldn't be delivered. Try again.";
        throw new AssistantError('message_not_sent', 409, notSent);
      }
      note(runId, 'user', text);
      return view(run);
    },

    async cancel(userId: string, runId: string) {
      const run = owned(userId, runId);
      if (isTerminal(run.status) || !run.taskId) return view(run);
      // 409: the task already ended; the watcher settles it.
      await tasks().stop(run.taskId).catch((error: unknown) => {
        if (statusOf(error) !== 409) throw error;
      });
      ledger.progress(runId, 'cancelling');
      return view(owned(userId, runId));
    },

    /** After a restart: re-lock the phones of open runs and watch them again. */
    resume() {
      for (const run of ledger.open()) {
        busyPhones.add(run.deviceId);
        if (!run.taskId) markUnknown(run.id);
        if (client) watch(run.id);
      }
    },
  };
}
