import {
  deviceSummarySchema,
  isTerminalStatus,
  type CancelTaskResponse,
  type DeviceSummary,
  type RunTaskRequest,
  type RunTaskResponse,
  type TaskStatus,
  type TaskView,
} from '@/shared/contracts';
import type {
  RunSessionStore,
  StreamCredentials,
} from './run-session-store';

type TaskRecord = {
  id?: string;
  deviceId?: string;
  status?: TaskStatus;
  succeeded?: boolean | null;
  steps?: number | null;
  output?: Record<string, unknown> | null;
  finishedAt?: string | null;
};

type DeviceRecord = {
  id?: string;
  name?: string;
  state?: string;
  type?: string;
  streamUrl?: string | null;
  streamToken?: string | null;
};

type RunResult = {
  id: string;
  status: TaskStatus;
  streamUrl?: string | null;
};

export interface TaskServiceDeps {
  runTask: (input: RunTaskRequest) => Promise<RunResult>;
  listDevices: () => Promise<Array<DeviceRecord>>;
  retrieveTask: (taskId: string) => Promise<{ task: TaskRecord }>;
  retrieveDevice: (deviceId: string) => Promise<DeviceRecord>;
  stopTask: (taskId: string) => Promise<CancelTaskResponse>;
}

export type TaskService = {
  start: (input: RunTaskRequest) => Promise<RunTaskResponse>;
  listDevices: () => Promise<Array<DeviceSummary>>;
  retrieve: (taskId: string) => Promise<TaskView>;
  cancel: (taskId: string) => Promise<CancelTaskResponse>;
};

function credentialsFrom(
  device: DeviceRecord,
  fallbackUrl?: string | null,
): StreamCredentials | undefined {
  const streamUrl = device.streamUrl ?? fallbackUrl;
  if (!streamUrl || !device.streamToken) return undefined;
  return { streamUrl, streamToken: device.streamToken };
}

export function createTaskService(
  deps: TaskServiceDeps,
  sessions: RunSessionStore,
): TaskService {
  const resolveCredentials = async (
    deviceId: string,
    fallbackUrl?: string | null,
  ): Promise<StreamCredentials | undefined> => {
    try {
      return credentialsFrom(await deps.retrieveDevice(deviceId), fallbackUrl);
    } catch {
      return undefined;
    }
  };

  return {
    async start(input) {
      const result = await deps.runTask(input);
      const credentials = await resolveCredentials(
        input.deviceId,
        result.streamUrl,
      );
      if (credentials) sessions.set(result.id, credentials);

      return {
        id: result.id,
        status: result.status,
        ...(credentials ?? {}),
      };
    },

    async listDevices() {
      const devices = await deps.listDevices();
      return devices.flatMap((device) => {
        const parsed = deviceSummarySchema.safeParse(device);
        return parsed.success ? [parsed.data] : [];
      });
    },

    async retrieve(taskId) {
      const { task } = await deps.retrieveTask(taskId);
      const status = task.status ?? 'created';

      if (isTerminalStatus(status)) {
        sessions.delete(taskId);
      }

      let credentials = isTerminalStatus(status)
        ? undefined
        : sessions.get(taskId);
      if (!credentials && task.deviceId && !isTerminalStatus(status)) {
        credentials = await resolveCredentials(task.deviceId);
        if (credentials) sessions.set(taskId, credentials);
      }

      return {
        id: task.id ?? taskId,
        status,
        succeeded: task.succeeded ?? null,
        steps: task.steps ?? null,
        output: task.output ?? null,
        finishedAt: task.finishedAt ?? null,
        ...(credentials ?? {}),
      };
    },

    cancel(taskId) {
      return deps.stopTask(taskId);
    },
  };
}
