import type { DemoDeviceDeps } from './session-service';

export type FakeDevices = DemoDeviceDeps & {
  calls: Array<string>;
  failNext: (step: keyof DemoDeviceDeps, error?: unknown) => void;
  terminated: () => Array<string>;
};

/** In-memory stand-in for the SDK adapter. Records every call in order. */
export function createFakeDevices(): FakeDevices {
  const calls: Array<string> = [];
  const failures = new Map<keyof DemoDeviceDeps, unknown>();
  const terminated: Array<string> = [];
  let counter = 0;

  const step = async (name: keyof DemoDeviceDeps, detail: string) => {
    calls.push(`${name}:${detail}`);
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
    terminated: () => terminated,
    async createDevice({ name }) {
      await step('createDevice', name);
      counter += 1;
      return { deviceId: `device-${counter}` };
    },
    async waitReady(deviceId) {
      await step('waitReady', deviceId);
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
      terminated.push(deviceId);
    },
  };
}
