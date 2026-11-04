import type { DemoDeviceDeps } from './session-service';

export type FakeDevices = DemoDeviceDeps & {
  calls: Array<string>;
  /** Makes the next call to `step` throw. */
  failNext: (step: keyof DemoDeviceDeps, error?: unknown) => void;
  /** Makes the next call to `step` wait; the returned function lets it go. */
  hold: (step: keyof DemoDeviceDeps) => () => void;
  terminated: () => Array<string>;
  /** Devices created and not yet terminated. */
  alive: () => Array<string>;
};

/** In-memory stand-in for the SDK adapter. Records every call in order. */
export function createFakeDevices(): FakeDevices {
  const calls: Array<string> = [];
  const failures = new Map<keyof DemoDeviceDeps, unknown>();
  const holds = new Map<keyof DemoDeviceDeps, Promise<void>>();
  const terminated: Array<string> = [];
  const alive = new Set<string>();
  let counter = 0;

  const step = async (
    name: keyof DemoDeviceDeps,
    detail: string,
    signal?: AbortSignal,
  ) => {
    calls.push(`${name}:${detail}`);
    const gate = holds.get(name);
    if (gate) {
      holds.delete(name);
      // Like the real SDK, a held call stops when its signal aborts.
      await Promise.race([
        gate,
        new Promise<never>((_, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
      ]);
    }
    if (failures.has(name)) {
      const error = failures.get(name);
      failures.delete(name);
      throw error;
    }
  };

  return {
    calls,
    failNext: (name, error = new Error(`${name} failed`)) => {
      failures.set(name, error);
    },
    hold: (name) => {
      let release: () => void = () => {};
      holds.set(
        name,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return release;
    },
    terminated: () => terminated,
    alive: () => [...alive],
    async createDevice({ name }) {
      await step('createDevice', name);
      counter += 1;
      alive.add(`device-${counter}`);
      return { deviceId: `device-${counter}` };
    },
    async waitReady(deviceId, { signal }) {
      await step('waitReady', deviceId, signal);
    },
    async enableKiosk(deviceId, packageName) {
      await step('enableKiosk', `${deviceId}:${packageName}`);
    },
    async startApp(deviceId, packageName) {
      await step('startApp', `${deviceId}:${packageName}`);
    },
    async retrieveStream(deviceId) {
      await step('retrieveStream', deviceId);
      return {
        streamUrl: `wss://stream.example/${deviceId}`,
        streamToken: `token-${deviceId}`,
      };
    },
    async terminate(deviceId) {
      await step('terminate', deviceId);
      alive.delete(deviceId);
      terminated.push(deviceId);
    },
  };
}
