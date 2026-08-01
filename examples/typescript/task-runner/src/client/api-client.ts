import type { z } from 'zod';
import {
  apiErrorSchema,
  cancelTaskResponseSchema,
  deviceListResponseSchema,
  runTaskResponseSchema,
  taskViewSchema,
  type CancelTaskResponse,
  type DeviceSummary,
  type RunTaskRequest,
  type RunTaskResponse,
  type TaskView,
} from '@/shared/contracts';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = 'invalid_response') {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, init);
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw new ApiClientError(
      error.success ? error.data.message : `Request failed (${response.status})`,
      response.status,
      error.success ? error.data.error : undefined,
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiClientError(
      'The server returned an invalid response.',
      response.status,
    );
  }
  return parsed.data;
}

export const taskRunnerApi = {
  start(
    input: RunTaskRequest,
    signal?: AbortSignal,
  ): Promise<RunTaskResponse> {
    return request('/api/runs', runTaskResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  },

  async listDevices(signal?: AbortSignal): Promise<Array<DeviceSummary>> {
    const response = await request('/api/devices', deviceListResponseSchema, {
      headers: { Accept: 'application/json' },
      signal,
    });
    return response.items;
  },

  retrieve(taskId: string, signal?: AbortSignal): Promise<TaskView> {
    return request(
      `/api/runs/${encodeURIComponent(taskId)}`,
      taskViewSchema,
      {
        headers: { Accept: 'application/json' },
        signal,
      },
    );
  },

  cancel(taskId: string, signal?: AbortSignal): Promise<CancelTaskResponse> {
    return request(
      `/api/runs/${encodeURIComponent(taskId)}/cancel`,
      cancelTaskResponseSchema,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
        signal,
      },
    );
  },
};
