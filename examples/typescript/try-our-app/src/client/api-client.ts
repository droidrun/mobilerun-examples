import type { z } from 'zod';
import {
  apiErrorSchema,
  endSessionResponseSchema,
  healthSchema,
  sessionViewSchema,
  streamViewSchema,
  type SessionView,
  type StreamView,
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
    throw new ApiClientError(
      'The server returned an invalid response.',
      response.status,
    );
  }
  return parsed.data;
}

export const demoApi = {
  health(signal?: AbortSignal) {
    return request('/api/health', healthSchema, { signal });
  },

  start(signal?: AbortSignal): Promise<SessionView> {
    return request('/api/sessions', sessionViewSchema, {
      method: 'POST',
      signal,
    });
  },

  stream(sessionId: string, signal?: AbortSignal): Promise<StreamView> {
    return request(
      `/api/sessions/${encodeURIComponent(sessionId)}/stream`,
      streamViewSchema,
      { signal },
    );
  },

  async end(sessionId: string, signal?: AbortSignal): Promise<void> {
    await request(
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      endSessionResponseSchema,
      { method: 'DELETE', signal },
    );
  },
};
