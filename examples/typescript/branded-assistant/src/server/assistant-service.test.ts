import { afterEach, describe, expect, test } from 'bun:test';
import { ApiProblem, UpstreamError } from './errors';
import {
  DEVICE_A,
  DEVICE_B,
  createHarness,
  type Harness,
} from './fake-deps';

let harness: Harness | undefined;

function setup(options?: Parameters<typeof createHarness>[0]): Harness {
  harness = createHarness(options);
  return harness;
}

const REQUEST = { presetId: 'hotel', message: 'Lisbon, 12–15 May' };

async function rejection(promise: Promise<unknown>): Promise<ApiProblem> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiProblem) return error;
    throw error;
  }
  throw new Error('expected the call to be rejected');
}

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

describe('starting a run', () => {
  test('reserves credits and sends the server-owned task options', async () => {
    const { service, fake } = setup();
    const run = await service.start('user-1', REQUEST);

    expect(run).toMatchObject({ status: 'starting', reserved: 20, charged: null, balance: 80 });
    expect(run.id).not.toBe('task-1');
    expect(run.streamUrl).toBe(`wss://stream.example/${DEVICE_A}`);

    const [started] = fake.calls.start;
    expect(started).toMatchObject({
      deviceId: DEVICE_A,
      maxSteps: 12,
      executionTimeout: 300,
      llmModel: 'secret/model-id',
    });
    expect(started?.systemPrompt).toContain('SECRET-SYSTEM-PROMPT');
    expect(started?.task).toContain('Lisbon, 12–15 May');
    expect(started?.outputSchema).toMatchObject({
      type: 'object',
      required: ['hotelName', 'notes'],
      additionalProperties: false,
    });
  });

  test('never exposes the Mobilerun task id, prompt or model', async () => {
    const { service } = setup();
    const run = await service.start('user-1', REQUEST);
    const serialized = JSON.stringify([run, service.session('user-1')]);

    expect(serialized).not.toContain('task-1');
    expect(serialized).not.toContain('SECRET-SYSTEM-PROMPT');
    expect(serialized).not.toContain('secret/model-id');
  });

  test('answers 402 when the balance cannot cover the reservation', async () => {
    const { service, fake } = setup({ startingBalance: 5 });
    const problem = await rejection(service.start('user-1', REQUEST));

    expect(problem).toMatchObject({ status: 402, code: 'insufficient_credits' });
    expect(fake.calls.start).toHaveLength(0);
    expect(service.session('user-1').balance).toBe(5);
  });

  test('concurrent starts cannot overspend a balance that covers one', async () => {
    const { service, fake } = setup({
      startingBalance: 30,
      deviceIds: [DEVICE_A, DEVICE_B],
    });
    const results = await Promise.allSettled([
      service.start('user-1', REQUEST),
      service.start('user-1', REQUEST),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(fake.calls.start).toHaveLength(1);
    expect(service.session('user-1').balance).toBe(10);
  });

  test('releases the phone and the reservation when the API rejects the start', async () => {
    const { service, fake } = setup();
    fake.control.startError = new UpstreamError(422, 'Device type unavailable');
    const problem = await rejection(service.start('user-1', REQUEST));

    expect(problem).toMatchObject({
      status: 422,
      code: 'upstream_error',
      message: 'Device type unavailable',
    });
    expect(service.session('user-1').balance).toBe(100);

    fake.control.startError = null;
    await expect(service.start('user-1', REQUEST)).resolves.toMatchObject({ status: 'starting' });
  });

  test('turns credential and outage errors into a 502', async () => {
    const { service, fake } = setup();
    fake.control.startError = new UpstreamError(401, 'bad key');
    expect(await rejection(service.start('user-1', REQUEST))).toMatchObject({
      status: 502,
      code: 'upstream_unauthorized',
    });
    fake.control.startError = new UpstreamError(500, 'boom');
    expect(await rejection(service.start('user-1', REQUEST))).toMatchObject({
      status: 502,
      code: 'upstream_unavailable',
    });
  });

  test('rejects unknown presets and a missing API key', async () => {
    const { service } = setup();
    expect(await rejection(service.start('user-1', { presetId: 'nope', message: 'x' }))).toMatchObject({
      status: 400,
      code: 'unknown_preset',
    });
    harness?.cleanup();
    const { service: unconfigured } = setup({ withDeps: false });
    expect(await rejection(unconfigured.start('user-1', REQUEST))).toMatchObject({
      status: 503,
      code: 'missing_api_key',
    });
  });
});

describe('one active run per phone', () => {
  test('answers 409 while every phone is busy, then frees the phone on finish', async () => {
    const { service, fake } = setup({ startingBalance: 100 });
    const first = await service.start('user-1', REQUEST);

    expect(await rejection(service.start('user-2', REQUEST))).toMatchObject({
      status: 409,
      code: 'device_busy',
    });
    // The rejected start must not have kept a reservation.
    expect(service.session('user-2').balance).toBe(100);

    fake.update('task-1', { status: 'completed', succeeded: true, creditsUsed: 3, output: { hotelName: 'Casa' } });
    await service.get('user-1', first.id);

    await expect(service.start('user-2', REQUEST)).resolves.toMatchObject({ status: 'starting' });
  });

  test('a second phone takes the next run', async () => {
    const { service, fake } = setup({ deviceIds: [DEVICE_A, DEVICE_B] });
    await service.start('user-1', REQUEST);
    await service.start('user-2', REQUEST);
    expect(fake.calls.start.map((call) => call.deviceId)).toEqual([DEVICE_A, DEVICE_B]);
  });
});

describe('settlement', () => {
  test('a completed run charges credits used, caps at the reservation and refunds the rest', async () => {
    const { service, fake } = setup();
    const run = await service.start('user-1', REQUEST);
    fake.update('task-1', {
      status: 'completed',
      succeeded: true,
      steps: 9,
      creditsUsed: 6.2,
      output: { hotelName: 'Casa Azul', notes: ['No refunds'] },
    });

    const done = await service.get('user-1', run.id);
    expect(done).toMatchObject({
      status: 'completed',
      charged: 7,
      balance: 93,
      result: { hotelName: 'Casa Azul', notes: ['No refunds'] },
    });
    expect(done.streamUrl).toBeUndefined();
  });

  test('usage above the reservation is capped', async () => {
    const { service, fake } = setup();
    const run = await service.start('user-1', REQUEST);
    fake.update('task-1', { status: 'completed', succeeded: true, creditsUsed: 999 });

    expect(await service.get('user-1', run.id)).toMatchObject({ charged: 20, balance: 80 });
  });

  test('a failed run refunds everything it did not use', async () => {
    const { service, fake } = setup();
    const run = await service.start('user-1', REQUEST);
    fake.update('task-1', { status: 'failed', creditsUsed: 2, message: 'Site unreachable' });

    expect(await service.get('user-1', run.id)).toMatchObject({
      status: 'failed',
      charged: 2,
      balance: 98,
      message: 'Site unreachable',
    });
  });

  test('a task that completes without success counts as failed', async () => {
    const { service, fake } = setup();
    const run = await service.start('user-1', REQUEST);
    fake.update('task-1', { status: 'completed', succeeded: false, creditsUsed: 0 });

    expect(await service.get('user-1', run.id)).toMatchObject({ status: 'failed', balance: 100 });
  });

  test('cancelling stops the task and refunds the unused reservation', async () => {
    const { service, fake } = setup();
    const run = await service.start('user-1', REQUEST);

    const cancelled = await service.cancel('user-1', run.id);
    expect(fake.calls.stops).toEqual(['task-1']);
    expect(cancelled).toMatchObject({ status: 'cancelled', charged: 0, balance: 100 });
  });

  test('settles exactly once however often the run is read', async () => {
    const { service, fake } = setup();
    const run = await service.start('user-1', REQUEST);
    fake.update('task-1', { status: 'completed', succeeded: true, creditsUsed: 4 });

    await Promise.all([service.get('user-1', run.id), service.get('user-1', run.id)]);
    await service.get('user-1', run.id);
    expect(service.session('user-1').balance).toBe(96);
  });
});

describe('progress and follow-ups', () => {
  test('surfaces agent text as a timeline and a question the user can answer', async () => {
    const { service, fake } = setup();
    const run = await service.start('user-1', REQUEST);

    fake.update('task-1', { steps: 2, lastResponse: { thought: 'Opening the booking site' } });
    let view = await service.get('user-1', run.id);
    expect(view.question).toBeNull();
    expect(view.timeline.map((entry) => entry.text)).toContain('Opening the booking site');

    fake.update('task-1', { steps: 3, lastResponse: { thought: 'Which airport do you prefer?' } });
    view = await service.get('user-1', run.id);
    expect(view.question).toBe('Which airport do you prefer?');

    view = await service.sendMessage('user-1', run.id, 'The one in the city');
    expect(fake.calls.messages).toEqual([{ taskId: 'task-1', message: 'The one in the city' }]);
    expect(view.question).toBeNull();
    expect(view.timeline.at(-1)).toMatchObject({ kind: 'user', text: 'The one in the city' });
  });

  test('refuses messages to a finished run', async () => {
    const { service, fake } = setup();
    const run = await service.start('user-1', REQUEST);
    fake.update('task-1', { status: 'completed', succeeded: true, creditsUsed: 1 });
    await service.get('user-1', run.id);

    expect(await rejection(service.sendMessage('user-1', run.id, 'hello'))).toMatchObject({
      status: 409,
      code: 'run_finished',
    });
  });
});

describe('ownership', () => {
  test("a user cannot read, message or cancel another user's run", async () => {
    const { service, fake } = setup();
    const run = await service.start('user-1', REQUEST);

    for (const attempt of [
      service.get('user-2', run.id),
      service.sendMessage('user-2', run.id, 'hi'),
      service.cancel('user-2', run.id),
    ]) {
      expect(await rejection(attempt)).toMatchObject({ status: 404, code: 'run_not_found' });
    }
    expect(fake.calls.messages).toEqual([]);
    expect(fake.calls.stops).toEqual([]);
    expect(service.session('user-2').runs).toEqual([]);
  });
});

describe('resume', () => {
  test('re-locks the phone of an open run after a restart', async () => {
    const { service, ledger, fake } = setup();
    await service.start('user-1', REQUEST);

    const { createAssistantService } = await import('./assistant-service');
    const { testAssistant } = await import('./fake-deps');
    const restarted = createAssistantService({
      ledger,
      deps: fake.deps,
      assistant: testAssistant,
      deviceIds: [DEVICE_A],
      reservePerRun: 20,
      pollIntervalMs: 0,
    });
    restarted.resume();

    expect(await rejection(restarted.start('user-2', REQUEST))).toMatchObject({ status: 409 });
  });
});
