import { describe, expect, spyOn, test } from 'bun:test';
import { createApiApp } from './api-app';
import type { TaskService } from './task-service';

const TASK_ID = '3c118ac1-b69d-4773-a4c2-ab6f072e7557';
const DEVICE_ID = '67937442-41bd-4a67-a16e-e1ce86c99568';

function createService(
  overrides: Partial<TaskService> = {},
): TaskService {
  return {
    start: async () => ({
      id: TASK_ID,
      status: 'created',
      streamUrl: 'wss://stream.example/device',
      streamToken: 'short-lived-token',
    }),
    listDevices: async () => [],
    retrieve: async () => ({
      id: TASK_ID,
      status: 'running',
      succeeded: null,
      steps: 1,
      output: null,
      finishedAt: null,
    }),
    cancel: async () => ({ cancelled: true }),
    ...overrides,
  };
}

describe('API contracts', () => {
  test('reports a missing server API key without leaking a secret', async () => {
    const app = createApiApp({ service: null });
    const response = await app.request('/api/devices');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'missing_api_key',
      message: 'Set MOBILERUN_CLOUD_API_KEY on the server.',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  test('rejects privileged SDK fields before starting a task', async () => {
    let startCalled = false;
    const app = createApiApp({
      service: createService({
        start: async () => {
          startCalled = true;
          throw new Error('must not run');
        },
      }),
    });
    const response = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Open Settings',
        deviceId: DEVICE_ID,
        credentials: [{ packageName: 'example', credentialNames: ['password'] }],
      }),
    });

    expect(response.status).toBe(400);
    expect(startCalled).toBe(false);
  });

  test('rejects malformed JSON without throwing', async () => {
    const app = createApiApp({ service: createService() });
    const response = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });

    expect(response.status).toBe(400);
  });

  test('rejects invalid task IDs before calling the service', async () => {
    let retrieveCalled = false;
    const app = createApiApp({
      service: createService({
        retrieve: async () => {
          retrieveCalled = true;
          throw new Error('must not run');
        },
      }),
    });

    const response = await app.request('/api/runs/not-a-uuid');

    expect(response.status).toBe(400);
    expect(retrieveCalled).toBe(false);
  });

  test('maps an already-terminal cancellation to a safe 409 response', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const app = createApiApp({
      service: createService({
        cancel: async () => {
          throw Object.assign(new Error('upstream detail'), { status: 409 });
        },
      }),
    });

    const response = await app.request(`/api/runs/${TASK_ID}/cancel`, {
      method: 'POST',
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'task_already_terminal',
      message: 'The task already reached a terminal state.',
    });
    consoleError.mockRestore();
  });
});
