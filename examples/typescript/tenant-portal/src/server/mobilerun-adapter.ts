import type Mobilerun from '@mobilerun/sdk';
import type { PortalDeps, RemoteDevice } from './portal-service';

type SdkDevice = Awaited<ReturnType<Mobilerun['devices']['retrieve']>>;

function toRemote(device: SdkDevice): RemoteDevice {
  return {
    id: device.id,
    state: device.state,
    stateMessage: device.stateMessage,
    createdAt: device.createdAt,
    // An empty string means "not streaming yet".
    streamUrl: device.streamUrl || undefined,
    streamToken: device.streamToken || undefined,
  };
}

/** The only module that calls @mobilerun/sdk. */
export function createMobilerunPortalDeps(client: Mobilerun): PortalDeps {
  return {
    async createDevice(name) {
      return toRemote(
        await client.devices.create(
          { deviceType: 'android_cloud_phone', name },
          // A retried create could provision (and bill) a second device.
          { maxRetries: 0 },
        ),
      );
    },
    async retrieveDevice(deviceId) {
      return toRemote(await client.devices.retrieve(deviceId));
    },
    async act(deviceId, action) {
      await client.devices[action](deviceId);
    },
    async terminateDevice(deviceId) {
      await client.devices.terminate(deviceId);
    },
  };
}
