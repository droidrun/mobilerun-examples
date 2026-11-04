import type {
  AdminOverview,
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
  stopDevice(deviceId: string): Promise<void>;
  resumeDevice(deviceId: string): Promise<void>;
  rebootDevice(deviceId: string): Promise<void>;
  resetDevice(deviceId: string): Promise<void>;
  terminateDevice(deviceId: string): Promise<void>;
};

export class PortalError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PortalError';
    this.status = status;
    this.code = code;
  }
}

export type PortalService = {
  create(userId: number): Promise<DeviceView>;
  get(userId: number): Promise<DeviceView>;
  stop(userId: number): Promise<void>;
  resume(userId: number): Promise<void>;
  reboot(userId: number): Promise<void>;
  reset(userId: number): Promise<void>;
  terminate(userId: number): Promise<void>;
  stream(userId: number): Promise<StreamCredentials>;
  adminOverview(): Promise<AdminOverview>;
};

type ServiceOptions = { maxDevicesPerUser: number };

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

export function createPortalService(
  deps: PortalDeps,
  store: PortalStore,
  options: ServiceOptions,
): PortalService {
  const creating = new Set<number>();

  // The device id always comes from the session user's own row. Nothing the
  // client sends can select a different device.
  function ownDeviceId(userId: number): string {
    const deviceId = store.getDeviceId(userId);
    if (!deviceId) throw noDevice();
    return deviceId;
  }

  const quotaReached = () =>
    new PortalError(
      409,
      'device_quota_reached',
      'You already have a device.',
    );

  async function act(
    userId: number,
    action: (deviceId: string) => Promise<void>,
  ): Promise<void> {
    await action(ownDeviceId(userId));
  }

  return {
    async create(userId) {
      if (
        creating.has(userId) ||
        store.countDevices(userId) >= options.maxDevicesPerUser
      ) {
        throw quotaReached();
      }
      creating.add(userId);
      try {
        const device = await deps.createDevice(`tenant-${userId}`);
        if (!store.insertDevice(userId, device.id)) {
          // Lost a race or the device id is already linked: release it.
          await deps.terminateDevice(device.id).catch((error: unknown) => {
            console.error('orphaned device cleanup failed', error);
          });
          throw quotaReached();
        }
        return toView(device);
      } finally {
        creating.delete(userId);
      }
    },

    async get(userId) {
      const deviceId = ownDeviceId(userId);
      try {
        const device = await deps.retrieveDevice(deviceId);
        if (device.state === 'terminated') {
          store.deleteDevice(userId);
          throw noDevice();
        }
        return toView(device);
      } catch (error) {
        if (isNotFound(error)) {
          // The device no longer exists upstream: drop the stale link.
          store.deleteDevice(userId);
          throw noDevice();
        }
        throw error;
      }
    },

    stop: (userId) => act(userId, (id) => deps.stopDevice(id)),
    resume: (userId) => act(userId, (id) => deps.resumeDevice(id)),
    reboot: (userId) => act(userId, (id) => deps.rebootDevice(id)),
    reset: (userId) => act(userId, (id) => deps.resetDevice(id)),

    async terminate(userId) {
      const deviceId = ownDeviceId(userId);
      try {
        await deps.terminateDevice(deviceId);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      store.deleteDevice(userId);
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

    async adminOverview() {
      const users = await Promise.all(
        store.listUsersWithDevices().map(async (user) => {
          let device: { state: string } | null = null;
          if (user.deviceId) {
            device = await deps
              .retrieveDevice(user.deviceId)
              .then((remote) => ({ state: remote.state }))
              .catch(() => ({ state: 'unknown' }));
          }
          return { email: user.email, createdAt: user.createdAt, device };
        }),
      );
      return { users };
    },
  };
}
