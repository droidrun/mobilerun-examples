import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { DemoError, createSessionService } from './session-service';
import { createSessionStore, type SessionStore } from './session-store';
import { createFakeDevices } from './test-support';

const TTL_MS = 5 * 60 * 1_000;
const PROVISION_TIMEOUT_MS = 60_000;

let openStore: SessionStore | undefined;
afterEach(() => {
  openStore?.close();
  openStore = undefined;
});

function setup(options: { maxConcurrent?: number } = {}) {
  const devices = createFakeDevices();
  const store = createSessionStore(':memory:');
  openStore = store;
  let clock = 1_000_000;
  let ids = 0;
  const service = createSessionService({
    deps: devices,
    store,
    appPackage: 'com.example.demo',
    ttlMs: TTL_MS,
    provisionTimeoutMs: PROVISION_TIMEOUT_MS,
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

const settle = () => Bun.sleep(0);

describe('session lifecycle', () => {
  test('creates, waits, locks to the app, starts it and expires', async () => {
    const { devices, service, store, advance } = setup();

    const session = await service.start('visitor-a');

    expect(devices.calls).toEqual([
      'createDevice:demo-00000000-0000-4000-8000-000000000001',
      'waitReady:device-1',
      'enableKiosk:device-1:com.example.demo',
      'startApp:device-1:com.example.demo',
    ]);
    expect(session.expiresInSeconds).toBe(TTL_MS / 1_000);
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
    const session = await service.start('visitor-a');

    await service.end(session.id, 'visitor-a');
    await service.end(session.id, 'visitor-a');

    expect(devices.terminated()).toEqual(['device-1']);
    expect(store.get(session.id)?.endReason).toBe('user');
  });

  test('treats a device that is already gone as ended', async () => {
    const { devices, service, store, advance } = setup();
    const session = await service.start('visitor-a');
    advance(TTL_MS);
    devices.failNext('terminate', Object.assign(new Error('gone'), { status: 404 }));

    await service.reap();

    expect(store.get(session.id)?.state).toBe('ended');
  });
});

describe('terminate failures keep the obligation', () => {
  test('an expired session stays open when terminate fails, then the reaper retries', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const { devices, service, store, advance } = setup({ maxConcurrent: 1 });
    const session = await service.start('visitor-a');
    advance(TTL_MS);
    devices.failNext('terminate');

    await service.reap();
    expect(store.get(session.id)?.state).toBe('ending');
    expect(store.countOpen()).toBe(1);

    await service.reap();
    expect(store.get(session.id)?.state).toBe('ended');
    expect(devices.alive()).toEqual([]);
    consoleError.mockRestore();
  });

  test('a failed start whose cleanup also fails is retried by the reaper, not forgotten', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const { devices, service, store } = setup({ maxConcurrent: 1 });
    devices.failNext('enableKiosk');
    devices.failNext('terminate');

    await expect(service.start('visitor-a')).rejects.toThrow('enableKiosk');

    const [row] = store.listOpen();
    expect(row).toMatchObject({ state: 'ending', deviceId: 'device-1', endReason: 'failed' });
    expect(devices.alive()).toEqual(['device-1']);
    // The slot is still taken while the device is alive.
    await expect(service.start('visitor-b')).rejects.toMatchObject({
      code: 'capacity_reached',
    });

    // Not expired yet: owed terminates are retried on every sweep anyway.
    await service.reap();

    expect(devices.alive()).toEqual([]);
    expect(store.countOpen()).toBe(0);
    consoleError.mockRestore();
  });

  test('a failed start terminates its device and frees the slot', async () => {
    const { devices, service, store } = setup();
    devices.failNext('enableKiosk');

    await expect(service.start('visitor-a')).rejects.toThrow('enableKiosk');

    expect(devices.terminated()).toEqual(['device-1']);
    expect(store.countOpen()).toBe(0);
    expect(devices.calls.some((call) => call.startsWith('startApp'))).toBe(false);
  });
});

describe('one close path', () => {
  test('concurrent end, reap and shutdown terminate the device once', async () => {
    const { devices, service, store, advance } = setup();
    const session = await service.start('visitor-a');
    advance(TTL_MS);
    const release = devices.hold('terminate');

    const closing = Promise.all([
      service.end(session.id, 'visitor-a'),
      service.reap(),
      service.shutdown(),
    ]);
    await settle();
    release();
    await closing;

    expect(devices.calls.filter((call) => call.startsWith('terminate'))).toEqual([
      'terminate:device-1',
    ]);
    expect(store.get(session.id)?.state).toBe('ended');
  });

  test('a device that arrives after its session was reaped is terminated, never promoted', async () => {
    const { devices, service, store, advance } = setup({ maxConcurrent: 1 });
    const releaseCreate = devices.hold('createDevice');

    const starting = service.start('visitor-a').catch((error: unknown) => error);
    await settle();
    advance(PROVISION_TIMEOUT_MS + TTL_MS);
    const reaping = service.reap();
    await settle();

    // The late device does not exist yet, and its slot is still counted.
    expect(devices.alive()).toEqual([]);
    await expect(service.start('visitor-b')).rejects.toMatchObject({
      code: 'capacity_reached',
    });

    const releaseTerminate = devices.hold('terminate');
    releaseCreate();
    await settle();
    await settle();

    // The device exists, is not live, and still holds the only slot.
    expect(devices.alive()).toEqual(['device-1']);
    expect(store.countOpen()).toBe(1);
    await expect(service.start('visitor-b')).rejects.toMatchObject({
      code: 'capacity_reached',
    });

    releaseTerminate();
    await reaping;

    expect(await starting).toMatchObject({ code: 'session_closed' });
    expect(devices.alive()).toEqual([]);
    expect(store.countOpen()).toBe(0);
    expect(devices.calls.some((call) => call.startsWith('waitReady'))).toBe(false);

    await expect(service.start('visitor-b')).resolves.toBeDefined();
    expect(devices.alive()).toEqual(['device-2']);
  });
});

describe('capacity and resume', () => {
  test('refuses starts beyond the concurrent limit and frees slots on end', async () => {
    const { service } = setup({ maxConcurrent: 2 });
    await service.start('visitor-a');
    const second = await service.start('visitor-b');

    const refused = await service.start('visitor-c').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(DemoError);
    expect(refused).toMatchObject({ code: 'capacity_reached', status: 503 });

    await service.end(second.id, 'visitor-b');
    await expect(service.start('visitor-c')).resolves.toBeDefined();
  });

  test("returns the visitor's running demo instead of a second device", async () => {
    const { devices, service } = setup();
    const session = await service.start('visitor-a');

    expect(service.current('visitor-a')?.id).toBe(session.id);
    expect(service.current('visitor-b')).toBeUndefined();
    expect(devices.calls.filter((call) => call.startsWith('createDevice'))).toHaveLength(1);
  });

  test('a visitor whose demo is still booting cannot start another', async () => {
    const { devices, service } = setup();
    const release = devices.hold('createDevice');
    const first = service.start('visitor-a');
    await settle();

    expect(service.current('visitor-a')).toBeUndefined();
    await expect(service.start('visitor-a')).rejects.toMatchObject({
      code: 'session_provisioning',
      status: 409,
    });

    release();
    await first;
  });
});

describe('stream ownership', () => {
  test('only the cookie owner receives stream credentials', async () => {
    const { service } = setup();
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

  test('stops handing out credentials once the demo expired or is ending', async () => {
    const { devices, service, advance } = setup();
    const session = await service.start('visitor-a');
    advance(TTL_MS);

    await expect(service.stream(session.id, 'visitor-a')).rejects.toMatchObject({
      code: 'session_ended',
      status: 410,
    });

    const other = await service.start('visitor-b');
    const release = devices.hold('terminate');
    const ending = service.end(other.id, 'visitor-b');
    await settle();
    await expect(service.stream(other.id, 'visitor-b')).rejects.toMatchObject({
      status: 410,
    });
    release();
    await ending;
  });
});

describe('shutdown', () => {
  test('terminates every open session and refuses new starts', async () => {
    const { devices, service, store } = setup();
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

  test('interrupts a booting device and terminates it', async () => {
    const { devices, service, store } = setup();
    devices.hold('waitReady'); // never released: only the abort signal can end it

    const starting = service.start('visitor-a').catch((error: unknown) => error);
    await settle();
    await settle();
    expect(devices.calls).toContain('waitReady:device-1');

    await service.shutdown();

    expect(await starting).toMatchObject({ name: 'AbortError' });
    expect(devices.terminated()).toEqual(['device-1']);
    expect(devices.alive()).toEqual([]);
    expect(store.countOpen()).toBe(0);
  });
});
