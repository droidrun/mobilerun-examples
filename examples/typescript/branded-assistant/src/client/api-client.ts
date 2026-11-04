import type { z } from 'zod';
import {
  apiErrorSchema,
  runViewSchema,
  sessionViewSchema,
  type RunView,
  type SessionView,
  type StartRunRequest,
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
  const response = await fetch(path, { credentials: 'same-origin', ...init });
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
    throw new ApiClientError('The server returned an invalid response.', response.status);
  }
  return parsed.data;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const runPath = (runId: string) => `/api/runs/${encodeURIComponent(runId)}`;

export const assistantApi = {
  session(signal?: AbortSignal): Promise<SessionView> {
    return request('/api/session', sessionViewSchema, { signal });
  },

  start(input: StartRunRequest, signal?: AbortSignal): Promise<RunView> {
    return request('/api/runs', runViewSchema, { ...json(input), signal });
  },

  run(runId: string, signal?: AbortSignal): Promise<RunView> {
    return request(runPath(runId), runViewSchema, { signal });
  },

  sendMessage(runId: string, message: string, signal?: AbortSignal): Promise<RunView> {
    return request(`${runPath(runId)}/messages`, runViewSchema, {
      ...json({ message }),
      signal,
    });
  },

  cancel(runId: string, signal?: AbortSignal): Promise<RunView> {
    return request(`${runPath(runId)}/cancel`, runViewSchema, {
      ...json({}),
      signal,
    });
  },
};
