import type { TimelineEntry } from '@/shared/contracts';
import { isTerminalStatus } from '@/shared/contracts';
import type { AssistantDeps } from './assistant-deps';
import type { Ledger, RunRecord } from './ledger';
import { mapStatus } from './progress';

/** In-memory state for active runs only; history lives in SQLite. */
export type LiveRun = {
  timeline: Array<TimelineEntry>;
  lastSteps: number;
  /** Set while the last attempt to reach the backend failed. */
  error: string | null;
};

const MAX_TIMELINE = 60;
const DEADLINE_MARGIN_MS = 60_000;

export type Schedule = (callback: () => Promise<void>, delayMs: number) => void;

export const timerSchedule: Schedule = (callback, delayMs) => {
  const timer = setTimeout(() => void callback(), delayMs);
  timer.unref?.();
};

export type RunWatcherOptions = {
  ledger: Ledger;
  deps: AssistantDeps;
  /** Phones in use; the watcher frees a phone when its run settles. */
  busyDevices: Set<string>;
  live: Map<string, LiveRun>;
  executionTimeoutSeconds: number;
  pollIntervalMs: number;
  schedule?: Schedule;
  now?: () => number;
};

export function liveRun(live: Map<string, LiveRun>, runId: string): LiveRun {
  let entry = live.get(runId);
  if (!entry) {
    entry = { timeline: [], lastSteps: 0, error: null };
    live.set(runId, entry);
  }
  return entry;
}

export function note(
  live: Map<string, LiveRun>,
  runId: string,
  kind: TimelineEntry['kind'],
  text: string,
): void {
  const entry = liveRun(live, runId);
  entry.timeline.push({ at: new Date().toISOString(), kind, text });
  if (entry.timeline.length > MAX_TIMELINE) entry.timeline.shift();
}

/**
 * The one polling path. It is authoritative: it moves runs forward, settles
 * credits, frees phones and gives up on runs past their deadline. The HTTP
 * routes only read what it has recorded.
 */
export function createRunWatcher(options: RunWatcherOptions) {
  const { ledger, deps, busyDevices, live } = options;
  const schedule = options.schedule ?? timerSchedule;
  const now = options.now ?? Date.now;
  const deadlineAfterMs = options.executionTimeoutSeconds * 1_000 + DEADLINE_MARGIN_MS;
  // Task ids the database has not recorded yet (the write failed after the
  // API accepted the task). The watcher keeps trying to record them.
  const pendingTaskIds = new Map<string, string>();

  const finish = (run: RunRecord): void => {
    busyDevices.delete(run.deviceId);
    live.delete(run.id);
    pendingTaskIds.delete(run.id);
  };

  const expire = async (run: RunRecord, taskId: string | undefined): Promise<void> => {
    console.warn(`run ${run.id} passed its deadline; stopping and settling`);
    let creditsUsed: number | null = null;
    if (taskId) {
      await deps.stopTask(taskId).catch(() => undefined);
      const result = await deps.retrieveTask(taskId).catch(() => null);
      creditsUsed = result?.creditsUsed ?? null;
    }
    ledger.settle(run.id, {
      status: 'failed',
      creditsUsed,
      message: 'The request took too long and was stopped.',
    });
    finish(run);
  };

  const sync = async (runId: string): Promise<void> => {
    const run = ledger.getRunById(runId);
    if (!run) return;
    if (run.charged !== null) return finish(run);

    const taskId = run.taskId ?? pendingTaskIds.get(runId);
    if (taskId && !run.taskId) {
      ledger.attachTask(runId, taskId);
      pendingTaskIds.delete(runId);
    }
    if (now() > Date.parse(run.createdAt) + deadlineAfterMs) {
      return expire(run, taskId);
    }
    // An unconfirmed start has nothing to poll; it waits for its deadline.
    if (!taskId) return;

    const entry = liveRun(live, runId);
    let state;
    try {
      state = await deps.getStatus(taskId);
    } catch (error) {
      console.error('task status failed', runId, error);
      entry.error = 'The assistant is hard to reach right now. Retrying.';
      return;
    }
    entry.error = null;

    const status = mapStatus(state.status, state.succeeded);
    const steps = state.steps ?? run.steps ?? 0;
    if (steps > entry.lastSteps) note(live, runId, 'status', `Step ${steps}`);
    entry.lastSteps = Math.max(entry.lastSteps, steps);

    if (!isTerminalStatus(status)) {
      ledger.updateProgress(runId, { status, steps });
      return;
    }

    let result;
    try {
      result = await deps.retrieveTask(taskId);
    } catch (error) {
      console.error('task retrieve failed', runId, error);
      entry.error = 'The assistant is hard to reach right now. Retrying.';
      return;
    }
    ledger.settle(runId, {
      status,
      creditsUsed: result.creditsUsed ?? null,
      output: result.output,
      message: result.message ?? state.message ?? null,
      steps: result.steps ?? steps,
    });
    finish(run);
  };

  const watch = (runId: string, pendingTaskId?: string): void => {
    if (pendingTaskId) pendingTaskIds.set(runId, pendingTaskId);
    const tick = async (): Promise<void> => {
      try {
        await sync(runId);
      } catch (error) {
        console.error('run sync failed', runId, error);
      }
      if (ledger.getRunById(runId)?.charged === null) {
        schedule(tick, options.pollIntervalMs);
      }
    };
    schedule(tick, options.pollIntervalMs);
  };

  return { watch };
}
