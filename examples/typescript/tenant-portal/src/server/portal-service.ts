import type Mobilerun from '@mobilerun/sdk';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { DeviceAction, DeviceView, StreamView } from '@/shared/contracts';
import type { PortalStore } from './store';

/** A refusal of this server's own, with an HTTP status and text the end user may read. */
export class PortalError extends Error {
  constructor(readonly code: string, readonly status: ContentfulStatusCode, message: string) {
    super(message);
  }
}

const NO_DEVICE = 'You do not have a phone.';
const HAS_DEVICE = 'You already have a phone.';
/** A 404 from the API means the device is already gone, which is fine here. */
const unlessGone = (error: unknown) => {
  if ((error as { status?: unknown } | null)?.status !== 404) throw error;
};
const view = ({ state, createdAt }: DeviceView): DeviceView => ({ state, createdAt });

export type PortalService = ReturnType<typeof createPortalService>;

/**
 * Ownership, the device lifecycle, and every @mobilerun/sdk call this example makes. The device
 * id always comes from the user's own row, never from the request. Cleanup only unlinks the
 * device a request captured, so a late request cannot remove the link to a replacement device.
 */
export function createPortalService(client: Mobilerun, store: PortalStore) {
  const { devices } = client;
  const creating = new Set<number>();

  const own = (userId: number) => {
    const deviceId = store.deviceId(userId);
    if (!deviceId) throw new PortalError('no_device', 404, NO_DEVICE);
    return deviceId;
  };

  /** Links a new phone to its user. One that cannot be linked bills with no owner: release it. */
  const linkOrRelease = async (userId: number, deviceId: string) => {
    try {
      if (store.link(userId, deviceId)) return;
      throw new PortalError('device_exists', 409, HAS_DEVICE);
    } catch (error) {
      console.error('releasing device that could not be linked', deviceId, error);
      await devices.terminate(deviceId).catch((cause: unknown) => {
        console.error('device is still running and not linked to any user', deviceId, cause);
      });
      throw error;
    }
  };

  return {
    async create(userId: number): Promise<DeviceView> {
      if (creating.has(userId) || store.deviceId(userId)) {
        throw new PortalError('device_exists', 409, HAS_DEVICE);
      }
      creating.add(userId);
      try {
        // No SDK retries: a retried create could provision, and bill, a second phone.
        const device = await devices.create(
          { deviceType: 'android_cloud_phone', name: `tenant-${userId}` },
          { maxRetries: 0 },
        );
        await linkOrRelease(userId, device.id);
        return view(device);
      } finally {
        creating.delete(userId);
      }
    },

    async get(userId: number): Promise<DeviceView> {
      const deviceId = own(userId);
      const device = await devices.retrieve(deviceId).catch(unlessGone);
      if (!device || device.state === 'terminated') {
        store.unlink(userId, deviceId); // gone upstream: drop the stale link
        throw new PortalError('no_device', 404, NO_DEVICE);
      }
      return view(device);
    },

    async act(userId: number, action: DeviceAction) {
      await devices[action](own(userId));
    },

    async terminate(userId: number) {
      const deviceId = own(userId);
      await devices.terminate(deviceId).catch(unlessGone);
      store.unlink(userId, deviceId);
    },

    /** The server decides whether the phone can stream: 409 until it has credentials. */
    async stream(userId: number): Promise<StreamView> {
      const { streamUrl, streamToken } = await devices.retrieve(own(userId));
      if (streamUrl && streamToken) return { streamUrl, streamToken };
      throw new PortalError('stream_unavailable', 409, 'Your phone is not on screen yet.');
    },
  };
}
