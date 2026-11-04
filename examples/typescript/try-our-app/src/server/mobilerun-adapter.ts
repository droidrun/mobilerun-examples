import Mobilerun from '@mobilerun/sdk';
import type { DemoDeviceDeps } from './session-service';

/**
 * The only file that talks to `@mobilerun/sdk`. Every demo phone is a
 * disposable Android cloud phone.
 */
export function createMobilerunDeviceDeps(client: Mobilerun): DemoDeviceDeps {
  return {
    async createDevice({ name }) {
      const device = await client.devices.create({
        deviceType: 'android_cloud_phone',
        name,
      });
      return { deviceId: device.id };
    },
    async waitReady(deviceId, { timeoutMs, signal }) {
      await client.devices.waitReady(deviceId, { timeout: timeoutMs, signal });
    },
    async enableKiosk(deviceId, packageName) {
      await client.devices.kiosk.enable(deviceId, { packageName });
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
