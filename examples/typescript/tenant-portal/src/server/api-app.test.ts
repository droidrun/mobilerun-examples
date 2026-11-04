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
    createdNames: [] as Array<string>,
    createFailure: null as UpstreamError | null,
    terminateFailure: null as Error | null,
    // When set, terminate/retrieve calls park here until a test releases them.
    holdTerminate: false,
    holdRetrieve: false,
    gates: [] as Array<() => void>,
    deps: {
      async createDevice(name) {
        if (fake.createFailure) throw fake.createFailure;
        counter += 1;
        fake.createdNames.push(name);
        const device: RemoteDevice = {
          id: `device-${counter}`,
          state: 'creating',
          createdAt: '2026-01-01T00:00:00Z',
          streamUrl: `wss://stream.example/device-${counter}`,
          streamToken: `token-${counter}`,
        };
        devices.set(device.id, device);
        return device;
      },
      async retrieveDevice(deviceId) {
        calls.push({ method: 'retrieve', deviceId });
        if (fake.holdRetrieve) {
          await new Promise<void>((resolve) => fake.gates.push(resolve));
        }
        const device = devices.get(deviceId);
        if (!device) throw new UpstreamError(404, {});
        return device;
      },
      async act(deviceId, action) {
        calls.push({ method: action, deviceId });
      },
      async terminateDevice(deviceId) {
        calls.push({ method: 'terminate', deviceId });
        if (fake.terminateFailure) throw fake.terminateFailure;
        if (fake.holdTerminate) {
          await new Promise<void>((resolve) => fake.gates.push(resolve));
        }
        devices.delete(deviceId);
      },
    } satisfies PortalDeps,
  };
  return fake;
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await Bun.sleep(5);
  }
  expect(condition()).toBe(true);
}

let directory: string;
let store: PortalStore;
let fake: ReturnType<typeof createFakeDeps>;
let errorLog: { mock: { calls: Array<Array<unknown>> } };

function buildApp(
  options: { withService?: boolean; store?: PortalStore } = {},
) {
  const portalStore = options.store ?? store;
  return createApiApp({
    service:
      options.withService === false
        ? null
        : createPortalService(fake.deps, portalStore),
    store: portalStore,
    sessionSecret: SECRET,
    production: false,
  });
}

type App = ReturnType<typeof buildApp>;

async function signIn(app: App, email: string): Promise<string> {
  const response = await app.request('/api/login', {
    method: 'POST',
    headers: { ...SAME_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie');
  expect(cookie).toBeTruthy();
  return (cookie as string).split(';')[0] as string;
}

// Same-origin browser requests carry an Origin header; the CSRF guard needs it.
const SAME_ORIGIN = { Origin: 'http://localhost' };

function call(app: App, method: string, path: string, cookie?: string) {
  return app.request(path, {
    method,
    headers: cookie ? { ...SAME_ORIGIN, Cookie: cookie } : SAME_ORIGIN,
  });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tenant-portal-'));
  store = createPortalStore(join(directory, 'nested', 'portal.sqlite'));
  fake = createFakeDeps();
  // Expected upstream failures are logged by the server; keep test output clean.
  errorLog = spyOn(console, 'error').mockImplementation(() => {});
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

    expect(await response.json()).toEqual({ email: ALICE });
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
    ] as const) {
      expect((await call(app, method, path)).status).toBe(401);
    }
  });

  test('rejects tampered and unsigned cookies', async () => {
    const app = buildApp();
    const aliceCookie = await signIn(app, ALICE);
    const bobCookie = await signIn(app, BOB);
    const sign = (cookie: string) =>
      decodeURIComponent(cookie.split('=')[1] as string).split('.') as [
        string,
        string,
      ];
    const [aliceId, aliceSignature] = sign(aliceCookie);
    const [bobId, bobSignature] = sign(bobCookie);
    expect([aliceId, bobId]).toEqual(['1', '2']);

    const cookie = (id: string, signature: string) =>
      `portal_session=${encodeURIComponent(`${id}.${signature}`)}`;
    // Flip one character of Alice's valid signature: same length and encoding.
    const flipped = aliceSignature.replace(
      /.$/,
      aliceSignature.endsWith('A') ? 'B' : 'A',
    );

    for (const forged of [
      // Bob exists, so only a failed MAC check can reject Alice's signature on his id.
      cookie(bobId, aliceSignature),
      cookie(aliceId, bobSignature),
      cookie(aliceId, flipped),
      `portal_session=${aliceId}`,
      cookie(aliceId, 'AAAA'),
    ]) {
      expect((await call(app, 'GET', '/api/me', forged)).status).toBe(401);
    }
    expect((await call(app, 'GET', '/api/me', aliceCookie)).status).toBe(200);
    expect((await call(app, 'GET', '/api/me', bobCookie)).status).toBe(200);
  });

  test('rejects cross-origin writes before they reach a handler', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    await call(app, 'POST', '/api/device', cookie);
    fake.calls.length = 0;

    for (const [method, path] of [
      ['POST', '/api/device/stop'],
      ['POST', '/api/device'],
      ['DELETE', '/api/device'],
    ] as const) {
      const response = await app.request(path, {
        method,
        headers: {
          Cookie: cookie,
          Origin: 'https://evil.example',
          'Sec-Fetch-Site': 'cross-site',
        },
      });
      expect(response.status).toBe(403);
    }
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'email=eve%40example.com',
    });
    expect(login.status).toBe(403);
    expect(fake.calls).toEqual([]);
    expect(store.getDeviceId(1)).toBe('device-1');
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
      message: 'Set MOBILERUN_CLOUD_API_KEY on the server.',
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
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(fake.createdNames).toEqual(['tenant-1']);
    expect(store.getDeviceId(1)).toBe('device-1');
  });

  test('rejects a second device with 409', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    expect((await call(app, 'POST', '/api/device', cookie)).status).toBe(201);
    const second = await call(app, 'POST', '/api/device', cookie);

    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe('device_exists');
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
    expect(store.getDeviceId(1)).toBeUndefined();
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

describe('device creation failures', () => {
  test('a store that throws on insert releases the new device', async () => {
    const throwing: PortalStore = {
      ...store,
      insertDevice() {
        throw new Error('SQLITE_BUSY');
      },
    };
    const app = buildApp({ store: throwing });
    const cookie = await signIn(app, ALICE);
    const response = await call(app, 'POST', '/api/device', cookie);

    expect(response.status).toBe(502);
    expect(fake.calls).toEqual([{ method: 'terminate', deviceId: 'device-1' }]);
    expect(fake.devices.size).toBe(0);
    expect(store.getDeviceId(1)).toBeUndefined();
    expect(errorLog.mock.calls.some((args) => args.includes('device-1'))).toBe(true);
  });

  test('logs the device id when the release itself fails', async () => {
    const throwing: PortalStore = {
      ...store,
      insertDevice() {
        throw new Error('SQLITE_BUSY');
      },
    };
    fake.terminateFailure = new Error('terminate failed');
    const app = buildApp({ store: throwing });
    const cookie = await signIn(app, ALICE);
    const response = await call(app, 'POST', '/api/device', cookie);

    expect(response.status).toBe(502);
    expect(fake.devices.has('device-1')).toBe(true);
    const stillRunning = errorLog.mock.calls.filter(
      (args) =>
        args.includes('device-1') &&
        String(args[0]).includes('still running'),
    );
    expect(stillRunning).toHaveLength(1);
  });

  test('a lost insert race releases the new device and answers 409', async () => {
    const racing: PortalStore = { ...store, insertDevice: () => false };
    const app = buildApp({ store: racing });
    const cookie = await signIn(app, ALICE);
    const response = await call(app, 'POST', '/api/device', cookie);

    expect(response.status).toBe(409);
    expect(fake.calls).toEqual([{ method: 'terminate', deviceId: 'device-1' }]);
  });
});

describe('late requests', () => {
  test('a second DELETE does not remove a replacement device row', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    await call(app, 'POST', '/api/device', cookie);

    fake.holdTerminate = true;
    const first = call(app, 'DELETE', '/api/device', cookie);
    const second = call(app, 'DELETE', '/api/device', cookie);
    await waitFor(() => fake.gates.length === 2);

    fake.gates[0]?.();
    expect((await first).status).toBe(204);
    fake.holdTerminate = false;
    expect((await call(app, 'POST', '/api/device', cookie)).status).toBe(201);
    expect(store.getDeviceId(1)).toBe('device-2');

    fake.gates[1]?.();
    expect((await second).status).toBe(204);
    expect(store.getDeviceId(1)).toBe('device-2');
    expect((await call(app, 'GET', '/api/device', cookie)).status).toBe(200);
  });

  test('a stale GET that finds 404 does not remove a replacement row', async () => {
    const app = buildApp();
    const cookie = await signIn(app, ALICE);
    await call(app, 'POST', '/api/device', cookie);

    fake.holdRetrieve = true;
    const stale = call(app, 'GET', '/api/device', cookie);
    await waitFor(() => fake.gates.length === 1);

    fake.holdRetrieve = false;
    expect((await call(app, 'DELETE', '/api/device', cookie)).status).toBe(204);
    expect((await call(app, 'POST', '/api/device', cookie)).status).toBe(201);

    fake.gates[0]?.();
    expect((await stale).status).toBe(404);
    expect(store.getDeviceId(1)).toBe('device-2');
  });

  test('a vanished device is unlinked exactly once', async () => {
    const deletes: Array<[number, string]> = [];
    const counting: PortalStore = {
      ...store,
      deleteDevice(userId, deviceId) {
        deletes.push([userId, deviceId]);
        store.deleteDevice(userId, deviceId);
      },
    };
    const app = buildApp({ store: counting });
    const cookie = await signIn(app, ALICE);
    await call(app, 'POST', '/api/device', cookie);
    fake.devices.clear();

    expect((await call(app, 'GET', '/api/device', cookie)).status).toBe(404);
    expect(deletes).toEqual([[1, 'device-1']]);
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
