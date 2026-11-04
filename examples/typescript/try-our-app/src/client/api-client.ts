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

/** Codes this example's own server uses to say "not now"; their text is ours to show. */
const OWN_REJECTIONS = new Set(['capacity_reached', 'rate_limited']);

/**
 * What a visitor reads when a demo could not start. Only the example's own
 * capacity and rate-limit rejections get their specific text; any other
 * failure (an API error, a network error) is the same plain sentence.
 */
export function startFailureMessage(error: unknown): string {
  return error instanceof ApiClientError && OWN_REJECTIONS.has(error.code)
    ? error.message
    : 'We could not start the demo. Please try again.';
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
