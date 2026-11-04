import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createApiApp } from './api-app';
import { createRateLimiter } from './rate-limiter';
import { createSessionService } from './session-service';
import { createSessionStore, type SessionStore } from './session-store';
import { createFakeDevices } from './test-support';

let openStore: SessionStore | undefined;
afterEach(() => {
  openStore?.close();
  openStore = undefined;
});

function setup(options: { rateLimitMax?: number; maxConcurrent?: number } = {}) {
  const devices = createFakeDevices();
  const store = createSessionStore(':memory:');
  openStore = store;
  const service = createSessionService({
    deps: devices,
    store,
    appPackage: 'com.android.chrome',
    ttlMs: 300_000,
    provisionTimeoutMs: 60_000,
    maxConcurrent: options.maxConcurrent ?? 5,
  });
  const app = createApiApp({
    service,
    limiter: createRateLimiter({
      max: options.rateLimitMax ?? 10,
      windowMs: 60_000,
    }),
    cookieSecret: 'test-secret-that-is-long-enough',
  });
  return { app, devices, store };
}

function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  return header.split(';')[0] ?? '';
}

async function startSession(app: ReturnType<typeof setup>['app'], cookie?: string) {
  const response = await app.request('/api/sessions', {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
  });
  return {
    response,
    cookie: cookie ?? cookieFrom(response),
    body: (await response.json()) as {
      id: string;
      expiresInSeconds: number;
      error?: string;
    },
  };
}

describe('API contracts', () => {
  test('reports a missing server API key without crashing', async () => {
    const app = createApiApp({
      service: null,
        limiter: createRateLimiter({ max: 1, windowMs: 1_000 }),
      cookieSecret: 'test-secret-that-is-long-enough',
    });

    const health = await app.request('/api/health');
    expect(await health.json()).toEqual({ ok: true, sdkConfigured: false });

    const response = await app.request('/api/sessions', { method: 'POST' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'missing_api_key',
      message: 'API key missing: set MOBILERUN_CLOUD_API_KEY on the server.',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  test('starts a demo, sets a signed visitor cookie and resumes on repeat', async () => {
    const { app, devices } = setup();

    const first = await startSession(app);
    expect(first.response.status).toBe(201);
    expect(first.response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(first.cookie).toStartWith('visitor=');
    expect(first.body.expiresInSeconds).toBe(300);

    const again = await startSession(app, first.cookie);
    expect(again.response.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(devices.calls.filter((call) => call.startsWith('createDevice'))).toHaveLength(1);
  });
});

describe('stream ownership', () => {
  test('returns stream credentials only to the cookie owner', async () => {
    const { app } = setup();
    const owner = await startSession(app);
    const stranger = await startSession(app);
    expect(stranger.body.id).not.toBe(owner.body.id);

    const own = await app.request(`/api/sessions/${owner.body.id}/stream`, {
      headers: { Cookie: owner.cookie },
    });
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({
      streamUrl: 'wss://stream.example/device-1',
      streamToken: 'token-device-1',
    });

    const other = await app.request(`/api/sessions/${owner.body.id}/stream`, {
      headers: { Cookie: stranger.cookie },
    });
    expect(other.status).toBe(404);

    const anonymous = await app.request(`/api/sessions/${owner.body.id}/stream`);
    expect(anonymous.status).toBe(404);

    const forged = await app.request(`/api/sessions/${owner.body.id}/stream`, {
      headers: { Cookie: 'visitor=forged-value.signature' },
    });
    expect(forged.status).toBe(404);
  });

  test('only the owner can end a demo', async () => {
    const { app, devices } = setup();
    const owner = await startSession(app);
    const stranger = await startSession(app);

    const denied = await app.request(`/api/sessions/${owner.body.id}`, {
      method: 'DELETE',
      headers: { Cookie: stranger.cookie },
    });
    expect(denied.status).toBe(404);
    expect(devices.terminated()).toEqual([]);

    const ended = await app.request(`/api/sessions/${owner.body.id}`, {
      method: 'DELETE',
      headers: { Cookie: owner.cookie },
    });
    expect(ended.status).toBe(200);
    expect(devices.terminated()).toEqual(['device-1']);
  });

  test('rejects malformed session IDs', async () => {
    const { app } = setup();
    const response = await app.request('/api/sessions/not-a-uuid/stream');
    expect(response.status).toBe(400);
  });
});

describe('limits', () => {
  test('rate limits repeated starts and says when to retry', async () => {
    const { app } = setup({ rateLimitMax: 1 });

    const first = await startSession(app);
    expect(first.response.status).toBe(201);
    await app.request(`/api/sessions/${first.body.id}`, {
      method: 'DELETE',
      headers: { Cookie: first.cookie },
    });

    const second = await startSession(app, first.cookie);
    expect(second.response.status).toBe(429);
    expect(second.body.error).toBe('rate_limited');
    expect(Number(second.response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(second.response.headers.get('Cache-Control')).toBe('no-store');

    // A fresh cookie from the same address is still limited by IP, and the
    // new cookie is still delivered with the error.
    const third = await startSession(app);
    expect(third.response.status).toBe(429);
    expect(third.cookie).toStartWith('visitor=');
  });

  test('answers 503 when every demo phone is busy', async () => {
    const { app } = setup({ maxConcurrent: 1 });
    await startSession(app);

    const busy = await startSession(app);
    expect(busy.response.status).toBe(503);
    expect(busy.body.error).toBe('capacity_reached');
  });

  test('renders API errors as returned', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const { app, devices, store } = setup();
    devices.failNext(
      'createDevice',
      Object.assign(new Error('422 DEVICE_TYPE_UNAVAILABLE'), {
        status: 422,
        error: { detail: 'Device type android_cloud_phone is unavailable.' },
      }),
    );

    const result = await startSession(app);

    expect(result.response.status).toBe(422);
    expect(result.body).toMatchObject({
      error: 'demo_unavailable',
      message: 'Device type android_cloud_phone is unavailable.',
    });
    expect(store.countOpen()).toBe(0);
    consoleError.mockRestore();
  });
});
