import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { DemoError, createSessionService } from './session-service';
import { createSessionStore, type SessionStore } from './session-store';
import { createFakeDevices } from './test-support';

const TTL_MS = 5 * 60 * 1_000;

function setup(options: { maxConcurrent?: number } = {}) {
  const devices = createFakeDevices();
  const store = createSessionStore(':memory:');
  let clock = 1_000_000;
  let ids = 0;
  const service = createSessionService({
    deps: devices,
    store,
    appPackage: 'com.example.demo',
    ttlMs: TTL_MS,
    provisionTimeoutMs: 60_000,
    maxConcurrent: options.maxConcurrent ?? 2,
    now: () => clock,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  });
  return {
    devices,
    store,
    service,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

let openStore: SessionStore | undefined;
afterEach(() => {
  openStore?.close();
  openStore = undefined;
});

describe('session lifecycle', () => {
  test('creates, waits, locks to the app, starts it and expires', async () => {
    const { devices, service, store, advance } = setup();
    openStore = store;

    const session = await service.start('visitor-a');

    expect(devices.calls).toEqual([
      'createDevice:demo-00000000-0000-4000-8000-000000000001',
      'waitReady:device-1',
      'enableKiosk:device-1:com.example.demo',
      'startApp:device-1:com.example.demo',
    ]);
    expect(Date.parse(session.expiresAt)).toBe(1_000_000 + TTL_MS);
    expect(store.get(session.id)?.state).toBe('live');

    advance(TTL_MS - 1);
    await service.reap();
    expect(devices.terminated()).toEqual([]);

    advance(1);
    await service.reap();
    expect(devices.terminated()).toEqual(['device-1']);
    expect(store.get(session.id)).toMatchObject({
      state: 'ended',
      endReason: 'expired',
    });
  });

  test('ends early on request and is idempotent', async () => {
    const { devices, service, store } = setup();
    openStore = store;
    const session = await service.start('visitor-a');

    await service.end(session.id, 'visitor-a');
    await service.end(session.id, 'visitor-a');

    expect(devices.terminated()).toEqual(['device-1']);
    expect(store.get(session.id)?.endReason).toBe('user');
  });

  test('terminates the device and records a failed start', async () => {
    const { devices, service, store } = setup();
    openStore = store;
    devices.failNext('enableKiosk');

    await expect(service.start('visitor-a')).rejects.toThrow('enableKiosk');

    expect(devices.terminated()).toEqual(['device-1']);
    expect(store.countOpen()).toBe(0);
    expect(devices.calls.some((call) => call.startsWith('startApp'))).toBe(false);
  });

  test('keeps an expired session open when terminate fails, then retries', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const { devices, service, store, advance } = setup();
    openStore = store;
    const session = await service.start('visitor-a');
    advance(TTL_MS);
    devices.failNext('terminate');

    await service.reap();
    expect(store.get(session.id)?.state).toBe('live');

    await service.reap();
    expect(store.get(session.id)?.state).toBe('ended');
    consoleError.mockRestore();
  });

  test('treats a device that is already gone as ended', async () => {
    const { devices, service, store, advance } = setup();
    openStore = store;
    const session = await service.start('visitor-a');
    advance(TTL_MS);
    devices.failNext('terminate', Object.assign(new Error('gone'), { status: 404 }));

    await service.reap();

    expect(store.get(session.id)?.state).toBe('ended');
  });
});

describe('capacity and resume', () => {
  test('refuses starts beyond the concurrent limit and frees slots on end', async () => {
    const { service, store } = setup({ maxConcurrent: 2 });
    openStore = store;
    await service.start('visitor-a');
    const second = await service.start('visitor-b');

    const refused = await service.start('visitor-c').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(DemoError);
    expect(refused).toMatchObject({ code: 'capacity_reached', status: 503 });

    await service.end(second.id, 'visitor-b');
    await expect(service.start('visitor-c')).resolves.toBeDefined();
  });

  test('returns the visitor\'s running demo instead of a second device', async () => {
    const { devices, service, store } = setup();
    openStore = store;
    const session = await service.start('visitor-a');

    expect(service.current('visitor-a')?.id).toBe(session.id);
    expect(service.current('visitor-b')).toBeUndefined();
    expect(devices.calls.filter((call) => call.startsWith('createDevice'))).toHaveLength(1);
  });
});

describe('stream ownership', () => {
  test('only the cookie owner receives stream credentials', async () => {
    const { service, store } = setup();
    openStore = store;
    const session = await service.start('visitor-a');

    await expect(service.stream(session.id, 'visitor-a')).resolves.toEqual({
      streamUrl: 'wss://stream.example/device-1',
      streamToken: 'token-device-1',
    });
    await expect(service.stream(session.id, 'visitor-b')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
    await expect(service.end(session.id, 'visitor-b')).rejects.toMatchObject({
      status: 404,
    });
  });

  test('stops handing out credentials once the demo expired', async () => {
    const { service, store, advance } = setup();
    openStore = store;
    const session = await service.start('visitor-a');
    advance(TTL_MS);

    await expect(service.stream(session.id, 'visitor-a')).rejects.toMatchObject({
      code: 'session_ended',
      status: 410,
    });
  });
});

describe('shutdown', () => {
  test('terminates every open session and refuses new starts', async () => {
    const { devices, service, store } = setup();
    openStore = store;
    const a = await service.start('visitor-a');
    const b = await service.start('visitor-b');

    await service.shutdown();

    expect(devices.terminated().sort()).toEqual(['device-1', 'device-2']);
    expect(store.get(a.id)?.endReason).toBe('shutdown');
    expect(store.get(b.id)?.endReason).toBe('shutdown');
    await expect(service.start('visitor-c')).rejects.toMatchObject({
      code: 'shutting_down',
    });
  });

  test('cleans up a device that is still booting', async () => {
    const { devices, service, store } = setup();
    openStore = store;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = devices.waitReady;
    devices.waitReady = async (deviceId, options) => {
      await gate;
      return original(deviceId, options);
    };

    const starting = service.start('visitor-a').catch((error: unknown) => error);
    await Bun.sleep(0);
    const shutdown = service.shutdown();
    release();
    await shutdown;

    expect(await starting).toBeInstanceOf(DemoError);
    expect(devices.terminated()).toContain('device-1');
    expect(store.countOpen()).toBe(0);
  });
});
