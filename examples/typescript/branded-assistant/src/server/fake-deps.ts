import { Database } from 'bun:sqlite';
import { z } from 'zod';
import type {
  AssistantDeps,
  StartTaskInput,
  TaskResultRecord,
  TaskStatusRecord,
} from './assistant-deps';
import { assistantConfigSchema } from './assistant-config';
import { createAssistantService } from './assistant-service';
import { createLedger, type Ledger } from './ledger';
import type { Preset } from './presets';

export const DEVICE_A = '11111111-1111-4111-8111-111111111111';
export const DEVICE_B = '22222222-2222-4222-8222-222222222222';

/** Shaped like an SDK APIError: what the real adapter lets through. */
export class FakeApiError extends Error {
  readonly status: number | undefined;

  constructor(status: number | undefined, message: string) {
    super(message);
    this.status = status;
  }
}

type FakeTask = TaskStatusRecord & TaskResultRecord;

/** A scriptable stand-in for the Mobilerun adapter. Never touches the network. */
export function createFakeDeps() {
  const tasks = new Map<string, FakeTask>();
  const calls = {
    start: [] as Array<StartTaskInput>,
    messages: [] as Array<{ taskId: string; message: string }>,
    stops: [] as Array<string>,
  };
  const control = {
    startError: null as Error | null,
    stopError: null as Error | null,
    statusError: null as Error | null,
    messageSent: true,
  };
  let counter = 0;

  const deps: AssistantDeps = {
    async startTask(input) {
      calls.start.push(input);
      if (control.startError) throw control.startError;
      counter += 1;
      const taskId = `task-${counter}`;
      tasks.set(taskId, { status: 'running', steps: 0 });
      return { taskId };
    },
    async getStatus(taskId) {
      if (control.statusError) throw control.statusError;
      const task = tasks.get(taskId);
      if (!task) throw new FakeApiError(404, 'task not found');
      return task;
    },
    async retrieveTask(taskId) {
      const task = tasks.get(taskId);
      if (!task) throw new FakeApiError(404, 'task not found');
      return task;
    },
    async sendMessage(taskId, message) {
      calls.messages.push({ taskId, message });
      return control.messageSent;
    },
    async stopTask(taskId) {
      calls.stops.push(taskId);
      if (control.stopError) throw control.stopError;
      const task = tasks.get(taskId);
      if (task) tasks.set(taskId, { ...task, status: 'cancelled' });
    },
  };

  return {
    deps,
    calls,
    control,
    update(taskId: string, patch: Partial<FakeTask>) {
      const task = tasks.get(taskId);
      if (!task) throw new Error(`unknown fake task ${taskId}`);
      tasks.set(taskId, { ...task, ...patch });
    },
  };
}

export const testAssistant = assistantConfigSchema.parse({
  persona: { displayName: 'Pip', tagline: 'Trip helper', tone: 'warm' },
  systemPrompt: 'SECRET-SYSTEM-PROMPT',
  llmModel: 'secret/model-id',
  maxSteps: 12,
  executionTimeout: 300,
});

export const testPresets: ReadonlyArray<Preset> = [
  {
    id: 'hotel',
    label: 'Hotel',
    hint: 'City and dates',
    instruction: 'Find a hotel.',
    output: z.strictObject({
      hotelName: z.string().meta({ title: 'Hotel', description: 'Name' }),
      notes: z.array(z.string()).meta({ title: 'Notes', description: 'Caveats' }),
    }),
  },
];

/** Deadline of a test run: executionTimeout (300 s) plus the watcher's margin. */
export const DEADLINE_MS = 300_000 + 60_000;

export type Harness = ReturnType<typeof createHarness>;

/** Service + fake adapter + in-memory SQLite + a hand-cranked watcher clock. */
export function createHarness(
  options: {
    startingBalance?: number;
    reservePerRun?: number;
    deviceIds?: Array<string>;
    withDeps?: boolean;
    wrapLedger?: (ledger: Ledger) => Ledger;
  } = {},
) {
  const db = new Database(':memory:');
  const realLedger = createLedger(db, options.startingBalance ?? 100);
  const ledger = options.wrapLedger ? options.wrapLedger(realLedger) : realLedger;
  const fake = createFakeDeps();
  const clock = { now: Date.now() };
  const scheduled: Array<() => Promise<void>> = [];
  const service = createAssistantService({
    ledger,
    deps: options.withDeps === false ? null : fake.deps,
    assistant: testAssistant,
    presets: testPresets,
    deviceIds: options.deviceIds ?? [DEVICE_A],
    reservePerRun: options.reservePerRun ?? 20,
    pollIntervalMs: 1_000,
    schedule: (callback) => {
      scheduled.push(callback);
    },
    now: () => clock.now,
  });
  return {
    db,
    ledger,
    fake,
    clock,
    service,
    /** Runs every scheduled watcher poll once. */
    async tick() {
      for (const callback of scheduled.splice(0)) await callback();
    },
    accountCount(): number {
      return db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM accounts').get()?.n ?? 0;
    },
  };
}
