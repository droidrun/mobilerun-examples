import type {
  DeviceAction,
  DeviceView,
  StreamCredentials,
} from '@/shared/contracts';
import type { PortalStore } from './store';

/** The device fields the portal needs, independent of SDK response types. */
export type RemoteDevice = {
  id: string;
  state: string;
  stateMessage: string;
  createdAt: string;
  streamUrl?: string | undefined;
  streamToken?: string | undefined;
};

/** Everything the portal asks of Mobilerun. Tests supply a fake. */
export type PortalDeps = {
  createDevice(name: string): Promise<RemoteDevice>;
  retrieveDevice(deviceId: string): Promise<RemoteDevice>;
  act(deviceId: string, action: DeviceAction): Promise<void>;
  terminateDevice(deviceId: string): Promise<void>;
};

export class PortalError extends Error {
  readonly status: 404 | 409;
  readonly code: string;

  constructor(status: 404 | 409, code: string, message: string) {
    super(message);
    this.name = 'PortalError';
    this.status = status;
    this.code = code;
  }
}

export type PortalService = {
  create(userId: number): Promise<DeviceView>;
  get(userId: number): Promise<DeviceView>;
  act(userId: number, action: DeviceAction): Promise<void>;
  terminate(userId: number): Promise<void>;
  stream(userId: number): Promise<StreamCredentials>;
};

function toView(device: RemoteDevice): DeviceView {
  return {
    state: device.state,
    stateMessage: device.stateMessage,
    createdAt: device.createdAt,
  };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 404
  );
}

const noDevice = () =>
  new PortalError(404, 'no_device', 'You do not have a device.');

const alreadyHasDevice = () =>
  new PortalError(409, 'device_exists', 'You already have a device.');

export function createPortalService(
  deps: PortalDeps,
  store: PortalStore,
): PortalService {
  const creating = new Set<number>();

  // The device id always comes from the session user's own row. Nothing the
  // client sends can select a different device. Cleanup below only ever
  // removes the link to the device a request captured here, so a late request
  // cannot delete the row of a replacement device.
  function ownDeviceId(userId: number): string {
    const deviceId = store.getDeviceId(userId);
    if (!deviceId) throw noDevice();
    return deviceId;
  }

  return {
    async create(userId) {
      if (creating.has(userId) || store.getDeviceId(userId)) {
        throw alreadyHasDevice();
      }
      creating.add(userId);
      try {
        // Retries are off in the adapter: a repeated create could bill twice.
        const device = await deps.createDevice(`tenant-${userId}`);
        try {
          if (!store.insertDevice(userId, device.id)) throw alreadyHasDevice();
        } catch (error) {
          // The device exists and bills, but we could not record the owner.
          console.error('releasing device that could not be linked', device.id, error);
          await deps.terminateDevice(device.id).catch((terminateError: unknown) => {
            console.error(
              'device is still running and not linked to any user',
              device.id,
              terminateError,
            );
          });
          throw error;
        }
        return toView(device);
      } finally {
        creating.delete(userId);
      }
    },

    async get(userId) {
      const deviceId = ownDeviceId(userId);
      let device: RemoteDevice;
      try {
        device = await deps.retrieveDevice(deviceId);
      } catch (error) {
        if (!isNotFound(error)) throw error;
        // The device no longer exists upstream: drop the stale link.
        store.deleteDevice(userId, deviceId);
        throw noDevice();
      }
      if (device.state === 'terminated') {
        store.deleteDevice(userId, deviceId);
        throw noDevice();
      }
      return toView(device);
    },

    async act(userId, action) {
      await deps.act(ownDeviceId(userId), action);
    },

    async terminate(userId) {
      const deviceId = ownDeviceId(userId);
      try {
        await deps.terminateDevice(deviceId);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      store.deleteDevice(userId, deviceId);
    },

    async stream(userId) {
      const device = await deps.retrieveDevice(ownDeviceId(userId));
      if (!device.streamUrl || !device.streamToken) {
        throw new PortalError(
          409,
          'stream_unavailable',
          'The device is not streaming yet.',
        );
      }
      return { streamUrl: device.streamUrl, streamToken: device.streamToken };
    },
  };
}
