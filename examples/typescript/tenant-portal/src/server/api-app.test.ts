import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiApp } from './api-app';
import {
  createPortalService,
  type PortalDeps,
  type RemoteDevice,
} from './portal-service';
import { createPortalStore, type PortalStore } from './store';

const SECRET = 's'.repeat(40);
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const ADMIN = 'admin@example.com';

class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly error: Record<string, unknown>,
  ) {
    super(`${status}`);
  }
}

/** In-memory stand-in for the Mobilerun adapter that records every call. */
function createFakeDeps() {
  const devices = new Map<string, RemoteDevice>();
  const calls: Array<{ method: string; deviceId: string }> = [];
  let counter = 0;
  const fake = {
    devices,
    calls,
    createFailure: null as UpstreamError | null,
    deps: {
      async createDevice(name) {
        if (fake.createFailure) throw fake.createFailure;
        counter += 1;
        const device: RemoteDevice = {
          id: `device-${counter}`,
          state: 'creating',
          stateMessage: name,
          createdAt: '2026-01-01T00:00:00Z',
          streamUrl: `wss://stream.example/device-${counter}`,
          streamToken: `token-${counter}`,
        };
        devices.set(device.id, device);
        return device;
      },
      async retrieveDevice(deviceId) {
        calls.push({ method: 'retrieve', deviceId });
        const device = devices.get(deviceId);
        if (!device) throw new UpstreamError(404, {});
        return device;
      },
      async stopDevice(deviceId) {
        calls.push({ method: 'stop', deviceId });
      },
      async resumeDevice(deviceId) {
        calls.push({ method: 'resume', deviceId });
      },
      async rebootDevice(deviceId) {
        calls.push({ method: 'reboot', deviceId });
      },
      async resetDevice(deviceId) {
        calls.push({ method: 'reset', deviceId });
      },
      async terminateDevice(deviceId) {
        calls.push({ method: 'terminate', deviceId });
        devices.delete(deviceId);
      },
    } satisfies PortalDeps,
  };
  return fake;
}

let directory: string;
let store: PortalStore;
let fake: ReturnType<typeof createFakeDeps>;

function buildApp(options: { maxDevicesPerUser?: number; withService?: boolean } = {}) {
  return createApiApp({
    service:
      options.withService === false
        ? null
        : createPortalService(fake.deps, store, {
            maxDevicesPerUser: options.maxDevicesPerUser ?? 1,
          }),
    store,
    sessionSecret: SECRET,
    production: false,
    adminEmails: [ADMIN],
  });
}

type App = ReturnType<typeof buildApp>;

async function signIn(app: App, email: string): Promise<string> {
  const response = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie');
  expect(cookie).toBeTruthy();
  return (cookie as string).split(';')[0] as string;
}

function call(app: App, method: string, path: string, cookie?: string) {
  return app.request(path, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
  });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tenant-portal-'));
  store = createPortalStore(join(directory, 'nested', 'portal.sqlite'));
  fake = createFakeDeps();
  // Expected upstream failures are logged by the server; keep test output clean.
  spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  mock.restore();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('session', () => {
  test('login sets a signed HttpOnly SameSite=Lax cookie', async () => {
    const app = buildApp();
    const response = await app.request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ' Alice@Example.com ' }),
    });
    const cookie = response.headers.get('set-cookie') ?? '';

    expect(await response.json()).toEqual({ email: ALICE, isAdmin: false });
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('portal_session=');
  });

  test('rejects an invalid email', async () => {
    const response = await buildApp().request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(response.status).toBe(400);
  });

  test('requires a session for every device route', async () => {
    const app = buildApp();
    for (const [method, path] of [
      ['GET', '/api/me'],
      ['POST', '/api/device'],
      ['GET', '/api/device'],
      ['DELETE', '/api/device'],
      ['GET', '/api/device/stream'],
      ['POST', '/api/device/stop'],
      ['GET', '/api/admin/users'],
    ] as const) {
      expect((await call(app, method, path)).status).toBe(401);
    }
  });

  test('rejects tampered and unsigned cookies', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    const value = cookie.split('=')[1] as string;
    const [id, signature] = decodeURIComponent(value).split('.') as [string, string];

    const tampered = `portal_session=${encodeURIComponent(`2.${signature}`)}`;
    const unsigned = `portal_session=${id}`;
    const forgedSignature = `portal_session=${encodeURIComponent(`${id}.AAAA`)}`;

    for (const forged of [tampered, unsigned, forgedSignature]) {
      expect((await call(app, 'GET', '/api/me', forged)).status).toBe(401);
    }
    expect((await call(app, 'GET', '/api/me', cookie)).status).toBe(200);
  });

  test('logout clears the cookie', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    const response = await call(app, 'POST', '/api/logout', cookie);
    const cleared = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(cleared).toContain('portal_session=;');
    expect(cleared).toMatch(/Max-Age=0|Expires=/);
  });

  test('works without an API key until a device is requested', async () => {
    const app = buildApp({ withService: false });
    const cookie = await signIn(app, ALICE);

    expect(await (await call(app, 'GET', '/api/health')).json()).toEqual({
      ok: true,
      sdkConfigured: false,
    });
    const response = await call(app, 'GET', '/api/device', cookie);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'missing_api_key',
      message: 'Set MOBILERUN_API_KEY on the server.',
    });
  });
});

describe('device lifecycle', () => {
  test('creates one device named after the user and hides its id', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    const response = await call(app, 'POST', '/api/device', cookie);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      state: 'creating',
      stateMessage: 'tenant-1',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(store.getDeviceId(1)).toBe('device-1');
  });

  test('rejects a second device with 409', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    expect((await call(app, 'POST', '/api/device', cookie)).status).toBe(201);
    const second = await call(app, 'POST', '/api/device', cookie);

    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe('device_quota_reached');
    expect(fake.devices.size).toBe(1);
  });

  test('concurrent creates provision only one device', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    const results = await Promise.all([
      call(app, 'POST', '/api/device', cookie),
      call(app, 'POST', '/api/device', cookie),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(fake.devices.size).toBe(1);
  });

  test('a quota of zero closes provisioning', async () => {
    const app = buildApp({ maxDevicesPerUser: 0 });
    const cookie = await signIn(app, ALICE);
    expect((await call(app, 'POST', '/api/device', cookie)).status).toBe(409);
    expect(fake.devices.size).toBe(0);
  });

  test('renders Mobilerun API errors as returned', async () => {
    fake.createFailure = new UpstreamError(422, {
      message: 'Device type unavailable.',
    });
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    const response = await call(app, 'POST', '/api/device', cookie);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'upstream_rejected',
      message: 'Device type unavailable.',
    });
    expect(store.countDevices(1)).toBe(0);
  });

  test('does not blame the end user for a bad portal API key', async () => {
    fake.createFailure = new UpstreamError(401, { message: 'bad key' });
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    const response = await call(app, 'POST', '/api/device', cookie);

    expect(response.status).toBe(502);
    expect((await response.json()).message).not.toContain('bad key');
  });

  test('returns state and stream credentials for the owner', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    await call(app, 'POST', '/api/device', cookie);

    const state = await call(app, 'GET', '/api/device', cookie);
    expect((await state.json()).state).toBe('creating');

    const stream = await call(app, 'GET', '/api/device/stream', cookie);
    expect(await stream.json()).toEqual({
      streamUrl: 'wss://stream.example/device-1',
      streamToken: 'token-1',
    });
  });

  test('reports 409 while the device has no stream yet', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    await call(app, 'POST', '/api/device', cookie);
    const device = fake.devices.get('device-1') as RemoteDevice;
    fake.devices.set('device-1', { ...device, streamUrl: undefined });

    const response = await call(app, 'GET', '/api/device/stream', cookie);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('stream_unavailable');
  });

  test('stop, resume, reboot, and reset target the owner device', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    await call(app, 'POST', '/api/device', cookie);

    for (const action of ['stop', 'resume', 'reboot', 'reset']) {
      const response = await call(app, 'POST', `/api/device/${action}`, cookie);
      expect(response.status).toBe(202);
    }
    expect(fake.calls).toEqual([
      { method: 'stop', deviceId: 'device-1' },
      { method: 'resume', deviceId: 'device-1' },
      { method: 'reboot', deviceId: 'device-1' },
      { method: 'reset', deviceId: 'device-1' },
    ]);
  });

  test('terminate releases the device and removes the row', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    await call(app, 'POST', '/api/device', cookie);

    const response = await call(app, 'DELETE', '/api/device', cookie);
    expect(response.status).toBe(204);
    expect(store.getDeviceId(1)).toBeUndefined();
    expect(fake.devices.size).toBe(0);
    expect((await call(app, 'GET', '/api/device', cookie)).status).toBe(404);
    // The freed slot can be used again.
    expect((await call(app, 'POST', '/api/device', cookie)).status).toBe(201);
  });

  test('drops the link when the device is gone upstream', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    await call(app, 'POST', '/api/device', cookie);
    fake.devices.clear();

    expect((await call(app, 'GET', '/api/device', cookie)).status).toBe(404);
    expect(store.getDeviceId(1)).toBeUndefined();
  });
});

describe('ownership', () => {
  test('another user gets 404 on every device route and touches nothing', async () => {
    const app = buildApp();
    const alice = await signIn(app, ALICE);
    const bob = await signIn(app, BOB);
    await call(app, 'POST', '/api/device', alice);
    fake.calls.length = 0;

    for (const [method, path] of [
      ['GET', '/api/device'],
      ['GET', '/api/device/stream'],
      ['POST', '/api/device/stop'],
      ['POST', '/api/device/resume'],
      ['POST', '/api/device/reboot'],
      ['POST', '/api/device/reset'],
      ['DELETE', '/api/device'],
    ] as const) {
      const response = await call(app, method, path, bob);
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe('no_device');
    }

    expect(fake.calls).toEqual([]);
    expect(fake.devices.has('device-1')).toBe(true);
    expect(store.getDeviceId(1)).toBe('device-1');
  });

  test('client-supplied device ids are ignored or unroutable', async () => {
    const app = buildApp();
    const alice = await signIn(app, ALICE);
    const bob = await signIn(app, BOB);
    await call(app, 'POST', '/api/device', alice);
    fake.calls.length = 0;

    for (const [method, path] of [
      ['POST', '/api/device/device-1/stop'],
      ['DELETE', '/api/device/device-1'],
      ['GET', '/api/device/device-1/stream'],
    ] as const) {
      expect((await call(app, method, path, bob)).status).toBe(404);
    }
    const withQuery = await app.request('/api/device?deviceId=device-1', {
      headers: { Cookie: bob },
    });
    expect(withQuery.status).toBe(404);
    const withBody = await app.request('/api/device/stop', {
      method: 'POST',
      headers: { Cookie: bob, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'device-1' }),
    });
    expect(withBody.status).toBe(404);
    expect(fake.calls).toEqual([]);
  });

  test('each user controls only their own device', async () => {
    const app = buildApp();
    const alice = await signIn(app, ALICE);
    const bob = await signIn(app, BOB);
    await call(app, 'POST', '/api/device', alice);
    await call(app, 'POST', '/api/device', bob);

    await call(app, 'POST', '/api/device/reboot', bob);
    expect(fake.calls).toEqual([{ method: 'reboot', deviceId: 'device-2' }]);
  });
});

describe('admin overview', () => {
  test('is forbidden for regular users', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    expect((await call(app, 'GET', '/api/admin/users', cookie)).status).toBe(403);
  });

  test('lists users with device state for admins only', async () => {
    const app = buildApp();
    const alice = await signIn(app, ALICE);
    await signIn(app, BOB);
    const admin = await signIn(app, ADMIN);
    await call(app, 'POST', '/api/device', alice);

    const response = await call(app, 'GET', '/api/admin/users', admin);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(
      body.users.map((u: { email: string; device: unknown }) => [u.email, u.device]),
    ).toEqual([
      [ALICE, { state: 'creating' }],
      [BOB, null],
      [ADMIN, null],
    ]);
  });
});
