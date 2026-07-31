import { describe, expect, test } from 'bun:test';
import type { TaskStatus } from '@/shared/contracts';
import { createRunSessionStore } from './run-session-store';
import {
  createTaskService,
  type TaskServiceDeps,
} from './task-service';

const TASK_ID = '3c118ac1-b69d-4773-a4c2-ab6f072e7557';
const DEVICE_ID = '67937442-41bd-4a67-a16e-e1ce86c99568';

function createDeps(
  overrides: Partial<TaskServiceDeps> = {},
): TaskServiceDeps {
  return {
    runTask: async () => ({
      id: TASK_ID,
      status: 'created',
      streamUrl: 'wss://stream.example/device',
    }),
    listDevices: async () => [
      {
        id: DEVICE_ID,
        name: 'Example device',
        state: 'ready',
        type: 'dedicated_premium_device',
      },
    ],
    retrieveTask: async () => ({
      task: {
        id: TASK_ID,
        deviceId: DEVICE_ID,
        status: 'running',
        succeeded: null,
        steps: 3,
        output: null,
        finishedAt: null,
      },
    }),
    retrieveDevice: async () => ({
      streamUrl: 'wss://stream.example/device',
      streamToken: 'refreshed-stream-token',
    }),
    stopTask: async () => ({ cancelled: true }),
    ...overrides,
  };
}

function createService(overrides: Partial<TaskServiceDeps> = {}) {
  return createTaskService(createDeps(overrides), createRunSessionStore());
}

describe('task service', () => {
  test('starts a task and returns scoped stream credentials', async () => {
    const result = await createService().start({
      task: 'Open Settings',
      deviceId: DEVICE_ID,
      maxSteps: 30,
    });

    expect(result).toEqual({
      id: TASK_ID,
      status: 'created',
      streamUrl: 'wss://stream.example/device',
      streamToken: 'refreshed-stream-token',
    });
  });

  test('returns a narrow task view without SDK-only fields', async () => {
    const task = await createService().retrieve(TASK_ID);

    expect(task).toEqual({
      id: TASK_ID,
      status: 'running',
      succeeded: null,
      steps: 3,
      output: null,
      finishedAt: null,
      streamUrl: 'wss://stream.example/device',
      streamToken: 'refreshed-stream-token',
    });
    expect('userId' in task).toBe(false);
    expect('trajectory' in task).toBe(false);
  });

  test('keeps task status when stream credential refresh fails', async () => {
    const service = createService({
      retrieveDevice: async () => {
        throw new Error('temporary device lookup failure');
      },
    });

    const task = await service.retrieve(TASK_ID);

    expect(task.status).toBe('running');
    expect(task.steps).toBe(3);
    expect(task.streamUrl).toBeUndefined();
    expect(task.streamToken).toBeUndefined();
  });

  test('does not refresh or expose credentials for terminal tasks', async () => {
    let deviceCalls = 0;
    const service = createService({
      retrieveTask: async () => ({
        task: {
          id: TASK_ID,
          deviceId: DEVICE_ID,
          status: 'completed',
          succeeded: true,
        },
      }),
      retrieveDevice: async () => {
        deviceCalls += 1;
        return {
          streamUrl: 'wss://stream.example/device',
          streamToken: 'must-not-leak',
        };
      },
    });

    const task = await service.retrieve(TASK_ID);

    expect(task.status).toBe('completed');
    expect(task.streamToken).toBeUndefined();
    expect(deviceCalls).toBe(0);
  });

  test('filters incomplete device records', async () => {
    const service = createService({
      listDevices: async () => [
        {
          id: DEVICE_ID,
          name: 'Example device',
          state: 'ready',
          type: 'dedicated_premium_device',
        },
        { id: 'incomplete', name: 'Missing state' },
      ],
    });

    expect(await service.listDevices()).toHaveLength(1);
  });

  test('passes cancellation to the SDK adapter', async () => {
    const cancelled: Array<string> = [];
    const service = createService({
      stopTask: async (taskId) => {
        cancelled.push(taskId);
        return { cancelled: true };
      },
    });

    await expect(service.cancel(TASK_ID)).resolves.toEqual({ cancelled: true });
    expect(cancelled).toEqual([TASK_ID]);
  });

  test('supports every known task status', () => {
    const statuses: Array<TaskStatus> = [
      'queued',
      'created',
      'running',
      'cancelling',
      'paused',
      'completed',
      'failed',
      'cancelled',
    ];
    expect(statuses).toHaveLength(8);
  });
});
