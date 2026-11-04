import { UpstreamError } from './errors';
import type {
  AssistantDeps,
  StartTaskInput,
  TaskResultRecord,
  TaskStatusRecord,
} from './assistant-service';
import { assistantConfigSchema } from './assistant-config';
import { createLedger, type Ledger } from './ledger';
import { createAssistantService } from './assistant-service';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEVICE_A = '11111111-1111-4111-8111-111111111111';
export const DEVICE_B = '22222222-2222-4222-8222-222222222222';

type FakeTask = TaskStatusRecord & TaskResultRecord;

/** A scriptable stand-in for the Mobilerun adapter. Never touches the network. */
export function createFakeDeps() {
  const tasks = new Map<string, FakeTask>();
  const calls = {
    start: [] as Array<StartTaskInput>,
    messages: [] as Array<{ taskId: string; message: string }>,
    stops: [] as Array<string>,
  };
  const control: { startError: UpstreamError | null; stopError: UpstreamError | null } = {
    startError: null,
    stopError: null,
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
      const task = tasks.get(taskId);
      if (!task) throw new UpstreamError(404, 'task not found');
      return task;
    },
    async retrieveTask(taskId) {
      const task = tasks.get(taskId);
      if (!task) throw new UpstreamError(404, 'task not found');
      return task;
    },
    async sendMessage(taskId, message) {
      calls.messages.push({ taskId, message });
    },
    async stopTask(taskId) {
      calls.stops.push(taskId);
      if (control.stopError) throw control.stopError;
      const task = tasks.get(taskId);
      if (task) tasks.set(taskId, { ...task, status: 'cancelled', creditsUsed: task.creditsUsed ?? 0 });
    },
    async getStream(deviceId) {
      return {
        streamUrl: `wss://stream.example/${deviceId}`,
        streamToken: `token-for-${deviceId}`,
      };
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
  presets: [
    {
      id: 'hotel',
      label: 'Hotel',
      hint: 'City and dates',
      instruction: 'Find a hotel.',
      outputFields: [
        { key: 'hotelName', label: 'Hotel', type: 'text', description: 'Name' },
        { key: 'notes', label: 'Notes', type: 'list', description: 'Caveats' },
      ],
    },
  ],
});

export type Harness = {
  ledger: Ledger;
  fake: ReturnType<typeof createFakeDeps>;
  service: ReturnType<typeof createAssistantService>;
  cleanup: () => void;
};

/** Service + fake adapter + a temporary SQLite file. */
export function createHarness(
  options: {
    startingBalance?: number;
    reservePerRun?: number;
    deviceIds?: Array<string>;
    withDeps?: boolean;
  } = {},
): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'branded-assistant-'));
  const ledger = createLedger(join(directory, 'ledger.sqlite'), options.startingBalance ?? 100);
  const fake = createFakeDeps();
  const service = createAssistantService({
    ledger,
    deps: options.withDeps === false ? null : fake.deps,
    assistant: testAssistant,
    deviceIds: options.deviceIds ?? [DEVICE_A],
    reservePerRun: options.reservePerRun ?? 20,
    pollIntervalMs: 0,
  });
  return {
    ledger,
    fake,
    service,
    cleanup() {
      service.stop();
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
