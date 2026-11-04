import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type Mobilerun from '@mobilerun/sdk';
import { createSessionService } from './session-service';
import { createSessionStore, type SessionStore } from './session-store';

const TTL_MS = 300_000;
const BOOT_MS = 60_000;
type Step = 'create' | 'waitReady' | 'startApp' | 'kiosk' | 'retrieve' | 'terminate';

/** The SDK calls the service makes. Any step can fail or wait until released. */
function fakeSdk() {
  const calls: Array<string> = [];
  const options: Array<unknown> = [];
  const alive = new Set<string>();
  const failures = new Map<Step, Array<unknown>>();
  const holds = new Map<Step, Promise<void>>();
  let count = 0;
  const step = async (name: Step, detail: string, signal?: AbortSignal) => {
    calls.push(`${name}:${detail}`);
    const gate = holds.get(name);
    holds.delete(name);
    if (gate) {
      // Like the SDK, a waiting call stops when its signal aborts.
      const aborted = new Promise<never>((_, reject) =>
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
      );
      await Promise.race([gate, aborted]);
    }
    const error = failures.get(name)?.shift();
    if (error) throw error;
  };
  const devices = {
    async create(params: { name: string }, requestOptions: unknown) {
      options.push(requestOptions);
      await step('create', params.name);
      alive.add(`device-${++count}`);
      return { id: `device-${count}` };
    },
    waitReady: (id: string, { signal }: { signal: AbortSignal }) => step('waitReady', id, signal),
    apps: { start: (app: string, { deviceId }: { deviceId: string }) => step('startApp', deviceId) },
    kiosk: {
      enable(id: string, params: { packageName: string }, requestOptions: unknown) {
        options.push(requestOptions);
        return step('kiosk', `${id}:${params.packageName}`);
      },
    },
    retrieve: async (id: string) => (await step('retrieve', id), { streamUrl: `wss://stream/${id}` }),
    terminate: async (id: string) => void (await step('terminate', id), alive.delete(id)),
  };
  return {
    client: { devices } as unknown as Mobilerun,
    calls,
    options,
    count: (name: Step) => calls.filter((call) => call.startsWith(`${name}:`)).length,
    alive: () => [...alive],
    fail: (name: Step, ...errors: Array<unknown>) =>
      void failures.set(name, errors.length > 0 ? errors : [new Error(`${name} failed`)]),
    hold(name: Step) {
      let release = () => {};
      holds.set(name, new Promise<void>((resolve) => (release = resolve)));
      return release;
    },
  };
}

let store: SessionStore;
afterEach(() => store.close());

function setup(maxConcurrent = 2) {
  const sdk = fakeSdk();
  const delays: Array<number> = [];
  let clock = 1_000_000;
  let ids = 0;
  store = createSessionStore(':memory:');
  const service = createSessionService({
    client: sdk.client,
    store,
    appPackage: 'com.example.demo',
    ttlMs: TTL_MS,
    provisionTimeoutMs: BOOT_MS,
    maxConcurrent,
    now: () => clock,
    newId: () => `session-${++ids}`,
    sleep: async (ms) => void delays.push(ms),
  });
  return { sdk, service, delays, advance: (ms: number) => void (clock += ms) };
}

const settle = () => Bun.sleep(0);
const quiet = () => spyOn(console, 'error').mockImplementation(() => {});
const noTask = () => new Error('500 kiosk: no task found for package com.example.demo');

describe('lifecycle', () => {
  test('creates without SDK retries, starts the app, locks to it, and terminates at expiry', async () => {
    const { sdk, service, advance } = setup();
    const session = await service.start('a');

    expect(sdk.calls).toEqual([
      'create:demo-session-1',
      'waitReady:device-1',
      'startApp:device-1',
      'kiosk:device-1:com.example.demo',
    ]);
    expect(sdk.options).toEqual([{ maxRetries: 0 }, { maxRetries: 0 }]);
    expect(session).toEqual({ id: 'session-1', expiresInSeconds: TTL_MS / 1_000 });

    advance(TTL_MS - 1);
    await service.reap();
    expect(sdk.alive()).toEqual(['device-1']);
    advance(1);
    await service.reap();
    expect(sdk.alive()).toEqual([]);
    expect(store.get(session.id)?.state).toBe('ended');
  });

  test('retries kiosk one second apart while the app has no task yet, up to five times', async () => {
    const { sdk, service, delays } = setup();
    sdk.fail('kiosk', noTask(), noTask());
    await service.start('a');
    expect(delays).toEqual([1_000, 1_000]);

    sdk.fail('kiosk', ...Array.from({ length: 6 }, noTask));
    await expect(service.start('b')).rejects.toThrow('no task found');
    expect(sdk.count('kiosk')).toBe(3 + 6);
    expect(sdk.alive()).toEqual(['device-1']);
  });

  test('ends early once, and treats a phone that is already gone as ended', async () => {
    const { sdk, service } = setup();
    const first = await service.start('a');
    await service.end(first.id, 'a');
    await service.end(first.id, 'a');
    expect(sdk.count('terminate')).toBe(1);

    const second = await service.start('b');
    sdk.fail('terminate', Object.assign(new Error('gone'), { status: 404 }));
    await service.end(second.id, 'b');
    expect(store.get(second.id)?.state).toBe('ended');
  });
});

describe('cleanup', () => {
  test('a failed start terminates its phone and frees the slot; other errors are not retried', async () => {
    const { sdk, service } = setup(1);
    sdk.fail('kiosk');

    await expect(service.start('a')).rejects.toThrow('kiosk failed');
    expect(sdk.count('kiosk')).toBe(1);
    expect(sdk.alive()).toEqual([]);
    await expect(service.start('b')).resolves.toBeDefined();
  });

  test('a failed terminate keeps the row and its slot until the reaper succeeds', async () => {
    const consoleError = quiet();
    const { sdk, service } = setup(1);
    sdk.fail('kiosk');
    sdk.fail('terminate');

    await expect(service.start('a')).rejects.toThrow('kiosk failed');
    expect(store.open()).toMatchObject([{ state: 'ending', deviceId: 'device-1' }]);
    await expect(service.start('b')).rejects.toMatchObject({ code: 'capacity_reached', status: 503 });

    // Not expired, but owed terminates are retried on every sweep.
    await service.reap();
    expect(sdk.alive()).toEqual([]);
    expect(store.open()).toEqual([]);
    consoleError.mockRestore();
  });

  test('concurrent end, reap and shutdown terminate the phone once', async () => {
    const { sdk, service, advance } = setup();
    const session = await service.start('a');
    advance(TTL_MS);
    const release = sdk.hold('terminate');

    const closing = Promise.all([service.end(session.id, 'a'), service.reap(), service.shutdown()]);
    await settle();
    release();
    await closing;
    expect(sdk.count('terminate')).toBe(1);
  });

  test('a phone that arrives after its session was reaped is terminated, never promoted', async () => {
    const { sdk, service, advance } = setup(1);
    const releaseCreate = sdk.hold('create');
    const starting = service.start('a').catch((error: unknown) => error);
    await settle();
    advance(BOOT_MS + TTL_MS);
    const reaping = service.reap();
    await settle();
    await expect(service.start('b')).rejects.toMatchObject({ code: 'capacity_reached' });

    const releaseTerminate = sdk.hold('terminate');
    releaseCreate();
    await settle();
    await settle();
    // The late phone exists, is not live, and still holds the only slot.
    expect(sdk.alive()).toEqual(['device-1']);
    await expect(service.start('b')).rejects.toMatchObject({ code: 'capacity_reached' });

    releaseTerminate();
    await reaping;
    expect(await starting).toMatchObject({ code: 'session_closed' });
    expect(sdk.count('waitReady')).toBe(0);
    await service.start('b');
    expect(sdk.alive()).toEqual(['device-2']);
  });
});

describe('limits', () => {
  test('refuses starts beyond the cap, and a second start while booting', async () => {
    const { sdk, service } = setup(2);
    const release = sdk.hold('create');
    const booting = service.start('a');
    await settle();
    await expect(service.start('a')).rejects.toMatchObject({ status: 409 });
    release();
    await booting;

    const second = await service.start('b');
    await expect(service.start('c')).rejects.toMatchObject({ code: 'capacity_reached' });
    await service.end(second.id, 'b');
    await expect(service.start('c')).resolves.toBeDefined();
  });

  test('stops handing out stream credentials once a demo expired or is ending', async () => {
    const { sdk, service, advance } = setup();
    const expired = await service.start('a');
    advance(TTL_MS);
    await expect(service.stream(expired.id, 'a')).rejects.toMatchObject({ status: 410 });

    const ending = await service.start('b');
    const release = sdk.hold('terminate');
    const closing = service.end(ending.id, 'b');
    await settle();
    await expect(service.stream(ending.id, 'b')).rejects.toMatchObject({ status: 410 });
    release();
    await closing;
  });
});

describe('shutdown', () => {
  test('terminates every open session and refuses new starts', async () => {
    const { sdk, service } = setup();
    await service.start('a');
    await service.start('b');

    await service.shutdown();
    expect(sdk.alive()).toEqual([]);
    await expect(service.start('c')).rejects.toMatchObject({ code: 'shutting_down' });
  });

  test('interrupts a phone that is still booting and terminates it', async () => {
    const { sdk, service } = setup();
    sdk.hold('waitReady'); // never released: only the shutdown abort can end it
    const starting = service.start('a').catch((error: unknown) => error);
    await settle();
    await settle();

    await service.shutdown();
    expect(await starting).toMatchObject({ name: 'AbortError' });
    expect(sdk.alive()).toEqual([]);
    expect(store.open()).toEqual([]);
  });
});
