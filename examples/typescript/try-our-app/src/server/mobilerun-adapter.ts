import Mobilerun from '@mobilerun/sdk';
import type { DemoDeviceDeps } from './session-service';

const KIOSK_RETRIES = 5;
const KIOSK_RETRY_DELAY_MS = 1_000;

/** Kiosk fails until the app's task shows up in the task list. */
function isNoTaskFound(error: unknown): boolean {
  return (
    error instanceof Error && /no task found/i.test(error.message)
  );
}

type AdapterOptions = {
  sleep?: (ms: number) => Promise<void>;
};

/**
 * The only file that talks to `@mobilerun/sdk`. Every demo phone is a
 * disposable Android cloud phone.
 */
export function createMobilerunDeviceDeps(
  client: Mobilerun,
  { sleep = Bun.sleep }: AdapterOptions = {},
): DemoDeviceDeps {
  return {
    async createDevice({ name }) {
      // No automatic retries: a retried create could leave a second, untracked phone.
      const device = await client.devices.create(
        { deviceType: 'android_cloud_phone', name },
        { maxRetries: 0 },
      );
      return { deviceId: device.id };
    },
    async waitReady(deviceId, { timeoutMs, signal }) {
      await client.devices.waitReady(deviceId, { timeout: timeoutMs, signal });
    },
    async enableKiosk(deviceId, packageName) {
      // Lock-task mode needs a running task of the package. The service starts
      // the app first, but its task can lag behind the start call, so retry
      // while the API says no task was found. The SDK's own retries are off so
      // this loop is the only one.
      for (let retry = 0; ; retry += 1) {
        try {
          await client.devices.kiosk.enable(
            deviceId,
            { packageName },
            { maxRetries: 0 },
          );
          return;
        } catch (error) {
          if (retry >= KIOSK_RETRIES || !isNoTaskFound(error)) throw error;
          await sleep(KIOSK_RETRY_DELAY_MS);
        }
      }
    },
    async startApp(deviceId, packageName) {
      await client.devices.apps.start(packageName, { deviceId });
    },
    async retrieveStream(deviceId) {
      const device = await client.devices.retrieve(deviceId);
      return {
        streamUrl: device.streamUrl,
        ...(device.streamToken ? { streamToken: device.streamToken } : {}),
      };
    },
    async terminate(deviceId) {
      await client.devices.terminate(deviceId);
    },
  };
}
