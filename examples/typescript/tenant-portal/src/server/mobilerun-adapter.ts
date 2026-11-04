import Mobilerun from '@mobilerun/sdk';
import type { PortalDeps, RemoteDevice } from './portal-service';

type SdkDevice = {
  id: string;
  state: string;
  stateMessage: string;
  createdAt: string;
  streamUrl?: string;
  streamToken?: string;
};

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
        await client.devices.create({
          deviceType: 'android_cloud_phone',
          name,
        }),
      );
    },
    async retrieveDevice(deviceId) {
      return toRemote(await client.devices.retrieve(deviceId));
    },
    async stopDevice(deviceId) {
      await client.devices.stop(deviceId);
    },
    async resumeDevice(deviceId) {
      await client.devices.resume(deviceId);
    },
    async rebootDevice(deviceId) {
      await client.devices.reboot(deviceId);
    },
    async resetDevice(deviceId) {
      await client.devices.reset(deviceId);
    },
    async terminateDevice(deviceId) {
      await client.devices.terminate(deviceId);
    },
  };
}
