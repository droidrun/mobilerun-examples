import type { z } from 'zod';
import {
  adminOverviewSchema,
  apiErrorSchema,
  deviceViewSchema,
  healthSchema,
  sessionSchema,
  streamCredentialsSchema,
  type AdminOverview,
  type DeviceView,
  type Health,
  type Session,
  type StreamCredentials,
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

async function send(
  path: string,
  init: RequestInit,
): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    // Show the server's message as returned, including Mobilerun's own 4xx text.
    const error = apiErrorSchema.safeParse(body);
    throw new ApiClientError(
      error.success ? error.data.message : `Request failed (${response.status})`,
      response.status,
      error.success ? error.data.error : undefined,
    );
  }
  return { response, body };
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const { response, body } = await send(path, init);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiClientError(
      'The server returned an invalid response.',
      response.status,
    );
  }
  return parsed.data;
}

const post = (signal?: AbortSignal): RequestInit => ({ method: 'POST', signal });

export const portalApi = {
  health(signal?: AbortSignal): Promise<Health> {
    return request('/api/health', healthSchema, { signal });
  },

  me(signal?: AbortSignal): Promise<Session> {
    return request('/api/me', sessionSchema, { signal });
  },

  login(email: string, signal?: AbortSignal): Promise<Session> {
    return request('/api/login', sessionSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal,
    });
  },

  async logout(signal?: AbortSignal): Promise<void> {
    await send('/api/logout', post(signal));
  },

  getDevice(signal?: AbortSignal): Promise<DeviceView> {
    return request('/api/device', deviceViewSchema, { signal });
  },

  createDevice(signal?: AbortSignal): Promise<DeviceView> {
    return request('/api/device', deviceViewSchema, post(signal));
  },

  async deviceAction(
    action: 'stop' | 'resume' | 'reboot' | 'reset',
    signal?: AbortSignal,
  ): Promise<void> {
    await send(`/api/device/${action}`, post(signal));
  },

  async terminateDevice(signal?: AbortSignal): Promise<void> {
    await send('/api/device', { method: 'DELETE', signal });
  },

  stream(signal?: AbortSignal): Promise<StreamCredentials> {
    return request('/api/device/stream', streamCredentialsSchema, { signal });
  },

  adminUsers(signal?: AbortSignal): Promise<AdminOverview> {
    return request('/api/admin/users', adminOverviewSchema, { signal });
  },
};
