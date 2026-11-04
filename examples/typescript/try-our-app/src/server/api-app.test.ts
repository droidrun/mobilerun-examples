import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type Mobilerun from '@mobilerun/sdk';
import { APIConnectionError, APIConnectionTimeoutError } from '@mobilerun/sdk';
import { createApiApp } from './api-app';
import { createRateLimiter } from './rate-limiter';
import { createSessionService } from './session-service';
import { createSessionStore, type SessionStore } from './session-store';

let store: SessionStore;
afterEach(() => store.close());

function setup(rateLimitMax = 10) {
  let count = 0;
  const calls: Array<string> = [];
  const terminated: Array<string> = [];
  const devices = {
    create: async (): Promise<{ id: string }> => {
      calls.push('create');
      return { id: `device-${++count}` };
    },
    waitReady: async () => {},
    apps: { start: async () => {} },
    kiosk: { enable: async () => {} },
    retrieve: async (id: string) => ({ streamUrl: `wss://stream/${id}`, streamToken: `token-${id}` }),
    terminate: async (id: string) => void terminated.push(id),
  };
  store = createSessionStore(':memory:');
  const service = createSessionService({
    client: { devices } as unknown as Mobilerun,
    store,
    appPackage: 'com.android.chrome',
    ttlMs: 300_000,
    provisionTimeoutMs: 60_000,
    maxConcurrent: 5,
  });
  const limiter = createRateLimiter({ max: rateLimitMax, windowMs: 60_000 });
  const app = createApiApp({ service, limiter, sessionSecret: 's'.repeat(40) });
  return { app, calls, devices, terminated };
}

type App = ReturnType<typeof setup>['app'];
/** What Bun.serve passes to fetch; the rate limit reads the client IP from it. */
const BUN_ENV = { server: { requestIP: () => ({ address: '203.0.113.7', family: 'IPv4', port: 1 }) } };

async function start(app: App, cookie?: string) {
  const response = await app.request('/api/sessions', as(cookie, 'POST'), BUN_ENV);
  const body = (await response.json()) as Record<string, string>;
  return { response, body, cookie: cookie ?? response.headers.get('set-cookie')?.split(';')[0] ?? '' };
}

/** Same-origin browser writes carry an Origin header; the CSRF guard checks it. */
function as(cookie?: string, method = 'GET') {
  return { method, headers: { Origin: 'http://localhost', ...(cookie && { Cookie: cookie }) } };
}
const upstream = (status: number, error: object) =>
  Object.assign(new Error(String(status)), { status, error });

describe('sessions API', () => {
  test('without an API key the page still loads and starts are refused with JSON', async () => {
    store = createSessionStore(':memory:');
    const limiter = createRateLimiter({ max: 1, windowMs: 1 });
    const app = createApiApp({ service: null, limiter, sessionSecret: 's'.repeat(40) });

    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true, sdkConfigured: false });
    const response = await app.request('/api/sessions', as(undefined, 'POST'), BUN_ENV);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'missing_api_key' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  test('sets a signed HttpOnly visitor cookie and hands a running demo back instead of a second phone', async () => {
    const { app } = setup();
    const first = await start(app);
    expect(first.response.status).toBe(201);
    expect(first.response.headers.get('set-cookie')).toContain('HttpOnly');

    const again = await start(app, first.cookie);
    expect(again.response.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
  });

  test('only the cookie that started a demo gets its stream or can end it', async () => {
    const { app, terminated } = setup();
    const owner = await start(app);
    const stranger = await start(app);
    const stream = `/api/sessions/${owner.body.id}/stream`;

    expect(await (await app.request(stream, as(owner.cookie))).json()).toEqual({
      streamUrl: 'wss://stream/device-1',
      streamToken: 'token-device-1',
    });
    expect((await app.request(stream, as(stranger.cookie))).status).toBe(404);
    expect((await app.request(stream)).status).toBe(404);
    expect((await app.request(stream, as('visitor=forged.signature'))).status).toBe(404);

    const session = `/api/sessions/${owner.body.id}`;
    expect((await app.request(session, as(stranger.cookie, 'DELETE'))).status).toBe(404);
    expect(terminated).toEqual([]);
    expect((await app.request(session, as(owner.cookie, 'DELETE'))).status).toBe(200);
    expect(terminated).toEqual(['device-1']);
  });

  test('rate limits new starts per cookie and per IP, and says when to retry', async () => {
    const { app } = setup(1);
    const first = await start(app);
    await app.request(`/api/sessions/${first.body.id}`, as(first.cookie, 'DELETE'));

    const second = await start(app, first.cookie);
    expect(second.response.status).toBe(429);
    expect(second.body.error).toBe('rate_limited');
    expect(Number(second.response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(second.response.headers.get('Cache-Control')).toBe('no-store');

    // A fresh cookie from the same address is still limited, and still delivered.
    const third = await start(app);
    expect(third.response.status).toBe(429);
    expect(third.cookie).toStartWith('visitor=');
  });

  test('rejects cross-origin writes before they reach a handler', async () => {
    const { app, calls, terminated } = setup();
    const owner = await start(app);
    calls.length = 0;
    const evil = { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' };
    for (const [method, path] of [
      ['POST', '/api/sessions'],
      ['DELETE', `/api/sessions/${owner.body.id}`],
    ] as const) {
      const headers = { ...evil, Cookie: owner.cookie };
      const response = await app.request(path, { method, headers });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'request_rejected' });
    }
    expect([calls, terminated]).toEqual([[], []]);
  });

  test('shows the text of an API 4xx, but not of a rejected key or a 5xx', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const { app, devices } = setup();
    let failure = upstream(422, { message: 'Device type unavailable.' });
    devices.create = async () => {
      throw failure;
    };
    const rejected = await start(app);
    expect(rejected.response.status).toBe(422);
    const message = 'Device type unavailable.';
    expect(rejected.body).toEqual({ error: 'upstream_rejected', message });
    failure = upstream(402, { title: 'Insufficient balance' });
    expect((await start(app)).body.message).toBe('Insufficient balance');

    for (const status of [401, 503]) {
      failure = upstream(status, { message: 'bad key' });
      const hidden = await start(app);
      expect(hidden.response.status).toBe(502);
      expect(hidden.body.error).toBe('upstream_error');
      expect(hidden.body.message).not.toContain('bad key');
    }
    expect(store.open()).toEqual([]);
    consoleError.mockRestore();
  });

  test('an API that cannot be reached (connection error, timeout) is a plain 502', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const { app, devices } = setup();
    for (const failure of [new APIConnectionError({}), new APIConnectionTimeoutError()]) {
      devices.create = async () => {
        throw failure;
      };
      const result = await start(app);
      expect(result.response.status).toBe(502);
      expect(result.body.error).toBe('upstream_error');
    }
    expect(store.open()).toEqual([]);
    consoleError.mockRestore();
  });

  test('answers with JSON even when something that is not an Error is thrown', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const { app, devices } = setup();
    devices.create = async () => {
      throw 'not an Error';
    };

    const result = await start(app);
    expect(result.response.status).toBe(500);
    expect(result.body.error).toBe('internal_error');
    consoleError.mockRestore();
  });
});
