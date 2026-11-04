import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type Mobilerun from '@mobilerun/sdk';
import { createApiApp } from './api-app';
import { createPortalService } from './portal-service';
import { createPortalStore, type PortalStore } from './store';

type Device = {
  id: string;
  state: string;
  createdAt: string;
  streamUrl: string;
  streamToken: string;
};
const upstream = (status: number, error: object = {}) =>
  Object.assign(new Error(String(status)), { status, error });

/** The slice of the SDK client the portal uses. Records calls; `hold` parks them on a gate. */
function fakeSdk() {
  const live = new Map<string, Device>();
  const calls: Array<string> = [];
  const gates: Array<() => void> = [];
  const hold = { retrieve: false, terminate: false };
  const park = (on: boolean) => (on ? new Promise<void>((go) => gates.push(go)) : undefined);
  const act = (name: string) => async (id: string) => void calls.push(`${name} ${id}`);
  const sdk = {
    live, calls, gates, hold,
    created: [] as Array<{ name: string; options: unknown }>,
    createFailure: undefined as Error | undefined,
    terminateFailure: undefined as Error | undefined,
    devices: {
      async create({ name }: { name: string }, options: unknown) {
        if (sdk.createFailure) throw sdk.createFailure;
        sdk.created.push({ name, options });
        const id = `device-${sdk.created.length}`;
        const streams = { streamUrl: `wss://stream/${id}`, streamToken: `token-${id}` };
        const device = { id, state: 'creating', createdAt: '2026-01-01T00:00:00Z', ...streams };
        live.set(id, device);
        return device;
      },
      async retrieve(id: string) {
        calls.push(`retrieve ${id}`);
        await park(hold.retrieve);
        const device = live.get(id);
        if (!device) throw upstream(404);
        return device;
      },
      stop: act('stop'), resume: act('resume'), reboot: act('reboot'), reset: act('reset'),
      async terminate(id: string) {
        calls.push(`terminate ${id}`);
        if (sdk.terminateFailure) throw sdk.terminateFailure;
        await park(hold.terminate);
        live.delete(id);
      },
    },
  };
  return sdk;
}

let store: PortalStore;
let sdk: ReturnType<typeof fakeSdk>;
let errors: { mock: { calls: Array<Array<unknown>> }; mockRestore: () => void };
beforeEach(() => {
  store = createPortalStore(':memory:');
  sdk = fakeSdk();
  errors = spyOn(console, 'error').mockImplementation(() => {}); // expected failures log
});
afterEach(() => {
  errors.mockRestore();
  store.close();
});

function setup(options: { store?: PortalStore; withKey?: boolean } = {}) {
  const portalStore = options.store ?? store;
  const client = { devices: sdk.devices } as unknown as Mobilerun;
  const service = options.withKey === false ? null : createPortalService(client, portalStore);
  const sessionSecret = 's'.repeat(40);
  const app = createApiApp({ service, store: portalStore, sessionSecret });
  // Same-origin browser writes carry an Origin header; the CSRF guard checks it.
  const call = (method: string, path: string, cookie?: string) =>
    app.request(path, {
      method,
      headers: { Origin: 'http://localhost', ...(cookie && { Cookie: cookie }) },
    });
  const signIn = async (email: string) => {
    const response = await app.request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    expect(response.status).toBe(200);
    return response.headers.get('set-cookie')?.split(';')[0] ?? '';
  };
  return { app, call, signIn };
}

async function waitFor(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i += 1) await Bun.sleep(5);
  expect(condition()).toBe(true);
}

const DEVICE_ROUTES = [
  ['GET', '/api/device'],
  ['GET', '/api/device/stream'],
  ['POST', '/api/device/stop'],
  ['POST', '/api/device/resume'],
  ['POST', '/api/device/reboot'],
  ['POST', '/api/device/reset'],
  ['DELETE', '/api/device'],
] as const;

describe('session', () => {
  test('login sets a signed HttpOnly SameSite=Lax cookie; logout clears it', async () => {
    const { app, call } = setup();
    const response = await app.request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ' Alice@Example.com ' }),
    });
    expect(await response.json()).toEqual({ email: 'alice@example.com' });
    expect(response.headers.get('set-cookie')).toMatch(/^portal_session=.*HttpOnly.*SameSite=Lax/);

    const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
    const cleared = (await call('POST', '/api/logout', cookie)).headers.get('set-cookie');
    expect(cleared).toMatch(/^portal_session=;.*(Max-Age=0|Expires=)/);

    const json = { 'Content-Type': 'application/json' };
    const body = '{"email":"x"}';
    const invalid = await app.request('/api/login', { method: 'POST', headers: json, body });
    expect(invalid.status).toBe(400);
  });

  test('every device route and /api/me need a session', async () => {
    const { call } = setup();
    const routes = [['GET', '/api/me'], ['POST', '/api/device'], ...DEVICE_ROUTES] as const;
    for (const [method, path] of routes) {
      expect((await call(method, path)).status).toBe(401);
    }
  });

  test('rejects tampered, swapped and unsigned cookies', async () => {
    const { call, signIn } = setup();
    const alice = await signIn('alice@example.com');
    const bob = await signIn('bob@example.com');
    const parts = (cookie: string) => decodeURIComponent(cookie.split('=')[1] ?? '').split('.');
    const [aliceId = '', aliceSig = ''] = parts(alice);
    const [bobId = '', bobSig = ''] = parts(bob);
    const cookie = (id: string, sig: string) =>
      `portal_session=${encodeURIComponent(`${id}.${sig}`)}`;
    const flipped = aliceSig.replace(/.$/, aliceSig.endsWith('A') ? 'B' : 'A');

    // Bob exists, so only the signature check can reject Alice's signature on his id.
    for (const forged of [
      cookie(bobId, aliceSig),
      cookie(aliceId, bobSig),
      cookie(aliceId, flipped),
      `portal_session=${aliceId}`,
      cookie(aliceId, 'AAAA'),
    ]) {
      expect((await call('GET', '/api/me', forged)).status).toBe(401);
    }
    expect((await call('GET', '/api/me', alice)).status).toBe(200);
    expect((await call('GET', '/api/me', bob)).status).toBe(200);
  });

  test('rejects cross-origin writes before they reach a handler', async () => {
    const { app, call, signIn } = setup();
    const cookie = await signIn('alice@example.com');
    await call('POST', '/api/device', cookie);
    sdk.calls.length = 0;
    const evil = { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' };

    for (const [method, path] of [
      ['POST', '/api/device/stop'],
      ['POST', '/api/device'],
      ['DELETE', '/api/device'],
    ] as const) {
      const headers = { ...evil, Cookie: cookie };
      expect((await app.request(path, { method, headers })).status).toBe(403);
    }
    const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const body = 'email=eve%40example.com';
    const headers = { ...evil, ...form };
    const login = await app.request('/api/login', { method: 'POST', headers, body });
    expect(login.status).toBe(403);
    expect(sdk.calls).toEqual([]);
    expect(store.deviceId(1)).toBe('device-1');
  });

  test('without an API key the page works until a device is requested', async () => {
    const { call, signIn } = setup({ withKey: false });
    const cookie = await signIn('alice@example.com');
    const health = await (await call('GET', '/api/health')).json();
    expect(health).toEqual({ ok: true, sdkConfigured: false });
    const response = await call('GET', '/api/device', cookie);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('missing_api_key');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('device lifecycle', () => {
  test('creates one device per user, without SDK retries, and never shows its id', async () => {
    const { call, signIn } = setup();
    const cookie = await signIn('alice@example.com');
    const response = await call('POST', '/api/device', cookie);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ state: 'creating', createdAt: '2026-01-01T00:00:00Z' });
    expect(sdk.created).toEqual([{ name: 'tenant-1', options: { maxRetries: 0 } }]);
    expect(store.deviceId(1)).toBe('device-1');

    const second = await call('POST', '/api/device', cookie);
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe('device_exists');
  });

  test('concurrent creates provision only one device', async () => {
    const { call, signIn } = setup();
    const cookie = await signIn('alice@example.com');
    const create = () => call('POST', '/api/device', cookie);
    const results = await Promise.all([create(), create()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(sdk.live.size).toBe(1);
  });

  test('passes API 4xx text through, but not a rejected portal key or a 5xx', async () => {
    const { call, signIn } = setup();
    const cookie = await signIn('alice@example.com');
    sdk.createFailure = upstream(422, { message: 'Device type unavailable.' });
    const rejected = await call('POST', '/api/device', cookie);
    expect(rejected.status).toBe(422);
    const message = 'Device type unavailable.';
    expect(await rejected.json()).toEqual({ error: 'upstream_rejected', message });

    for (const status of [401, 503]) {
      sdk.createFailure = upstream(status, { message: 'bad key' });
      const hidden = await call('POST', '/api/device', cookie);
      expect(hidden.status).toBe(502);
      expect((await hidden.json()).message).not.toContain('bad key');
    }
    expect(store.deviceId(1)).toBeUndefined();
  });

  test('the owner gets state and stream credentials; 409 while not streaming', async () => {
    const { call, signIn } = setup();
    const cookie = await signIn('alice@example.com');
    await call('POST', '/api/device', cookie);
    expect((await (await call('GET', '/api/device', cookie)).json()).state).toBe('creating');
    expect(await (await call('GET', '/api/device/stream', cookie)).json()).toEqual({
      streamUrl: 'wss://stream/device-1',
      streamToken: 'token-device-1',
    });

    sdk.live.set('device-1', { ...(sdk.live.get('device-1') as Device), streamUrl: '' });
    const notYet = await call('GET', '/api/device/stream', cookie);
    expect(notYet.status).toBe(409);
    expect((await notYet.json()).error).toBe('stream_unavailable');
  });

  test('stop, resume, reboot and reset reach the own device; other actions are 404', async () => {
    const { call, signIn } = setup();
    const cookie = await signIn('alice@example.com');
    await call('POST', '/api/device', cookie);
    for (const action of ['stop', 'resume', 'reboot', 'reset']) {
      expect((await call('POST', `/api/device/${action}`, cookie)).status).toBe(202);
    }
    expect((await call('POST', '/api/device/terminate', cookie)).status).toBe(404);
    expect(sdk.calls).toEqual(['stop', 'resume', 'reboot', 'reset'].map((a) => `${a} device-1`));
  });

  test('delete terminates the device, removes the row and frees the slot', async () => {
    const { call, signIn } = setup();
    const cookie = await signIn('alice@example.com');
    await call('POST', '/api/device', cookie);
    expect((await call('DELETE', '/api/device', cookie)).status).toBe(204);
    expect(sdk.live.size).toBe(0);
    expect((await call('GET', '/api/device', cookie)).status).toBe(404);
    expect((await call('POST', '/api/device', cookie)).status).toBe(201);
  });

  test('a device gone upstream is unlinked exactly once', async () => {
    const unlinks: Array<[number, string]> = [];
    const unlink = (userId: number, deviceId: string) => {
      unlinks.push([userId, deviceId]);
      store.unlink(userId, deviceId);
    };
    const counting: PortalStore = { ...store, unlink };
    const { call, signIn } = setup({ store: counting });
    const cookie = await signIn('alice@example.com');
    await call('POST', '/api/device', cookie);
    sdk.live.clear();
    expect((await call('GET', '/api/device', cookie)).status).toBe(404);
    expect(unlinks).toEqual([[1, 'device-1']]);
  });
});

describe('a device that cannot be linked is released', () => {
  const throwing = (): PortalStore => ({
    ...store,
    link: () => {
      throw new Error('SQLITE_BUSY');
    },
  });
  const logged = (text: string) =>
    errors.mock.calls.filter((args) => args.includes('device-1') && String(args[0]).includes(text));

  test('a store that throws: terminated, id logged', async () => {
    const { call, signIn } = setup({ store: throwing() });
    expect((await call('POST', '/api/device', await signIn('alice@example.com'))).status).toBe(500);
    expect(sdk.calls).toEqual(['terminate device-1']);
    expect(sdk.live.size).toBe(0);
    expect(logged('releasing')).toHaveLength(1);
  });

  test('a failed release logs the id once as still running', async () => {
    sdk.terminateFailure = new Error('terminate failed');
    const { call, signIn } = setup({ store: throwing() });
    expect((await call('POST', '/api/device', await signIn('alice@example.com'))).status).toBe(500);
    expect(sdk.live.has('device-1')).toBe(true);
    expect(logged('still running')).toHaveLength(1);
  });

  test('a lost insert race: terminated, 409', async () => {
    const { call, signIn } = setup({ store: { ...store, link: () => false } });
    expect((await call('POST', '/api/device', await signIn('alice@example.com'))).status).toBe(409);
    expect(sdk.calls).toEqual(['terminate device-1']);
  });
});

describe('late requests never touch a replacement device', () => {
  test('a second DELETE', async () => {
    const { call, signIn } = setup();
    const cookie = await signIn('alice@example.com');
    await call('POST', '/api/device', cookie);
    sdk.hold.terminate = true;
    const first = call('DELETE', '/api/device', cookie);
    const second = call('DELETE', '/api/device', cookie);
    await waitFor(() => sdk.gates.length === 2);

    sdk.gates[0]?.();
    expect((await first).status).toBe(204);
    sdk.hold.terminate = false;
    expect((await call('POST', '/api/device', cookie)).status).toBe(201);
    sdk.gates[1]?.();
    expect((await second).status).toBe(204);
    expect(store.deviceId(1)).toBe('device-2');
  });

  test('a stale GET that finds 404', async () => {
    const { call, signIn } = setup();
    const cookie = await signIn('alice@example.com');
    await call('POST', '/api/device', cookie);
    sdk.hold.retrieve = true;
    const stale = call('GET', '/api/device', cookie);
    await waitFor(() => sdk.gates.length === 1);

    sdk.hold.retrieve = false;
    expect((await call('DELETE', '/api/device', cookie)).status).toBe(204);
    expect((await call('POST', '/api/device', cookie)).status).toBe(201);
    sdk.gates[0]?.();
    expect((await stale).status).toBe(404);
    expect(store.deviceId(1)).toBe('device-2');
  });
});

describe('ownership', () => {
  test('another user gets 404 on every device route and touches nothing', async () => {
    const { call, signIn } = setup();
    const alice = await signIn('alice@example.com');
    const bob = await signIn('bob@example.com');
    await call('POST', '/api/device', alice);
    sdk.calls.length = 0;
    for (const [method, path] of DEVICE_ROUTES) {
      const response = await call(method, path, bob);
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe('no_device');
    }
    expect(sdk.calls).toEqual([]);
    expect(store.deviceId(1)).toBe('device-1');
  });

  test('client-supplied device ids are ignored or unroutable', async () => {
    const { app, call, signIn } = setup();
    const alice = await signIn('alice@example.com');
    const bob = await signIn('bob@example.com');
    await call('POST', '/api/device', alice);
    sdk.calls.length = 0;
    for (const [method, path] of [
      ['POST', '/api/device/device-1/stop'],
      ['DELETE', '/api/device/device-1'],
      ['GET', '/api/device/device-1/stream'],
      ['GET', '/api/device?deviceId=device-1'],
    ] as const) {
      expect((await call(method, path, bob)).status).toBe(404);
    }
    const headers = { Cookie: bob, Origin: 'http://localhost', 'Content-Type': 'application/json' };
    const body = '{"deviceId":"device-1"}';
    const withBody = await app.request('/api/device/stop', { method: 'POST', headers, body });
    expect(withBody.status).toBe(404);
    expect(sdk.calls).toEqual([]);

    await call('POST', '/api/device', bob);
    await call('POST', '/api/device/reboot', bob);
    expect(sdk.calls).toEqual(['reboot device-2']);
  });
});
