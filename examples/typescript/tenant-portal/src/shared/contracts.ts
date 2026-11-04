/** What the browser and this server exchange. The Mobilerun device id never leaves the server. */
export const DEVICE_ACTIONS = ['stop', 'resume', 'reboot', 'reset'] as const;
export type DeviceAction = (typeof DEVICE_ACTIONS)[number];
export type DeviceView = { state: string; createdAt: string };
export type StreamView = { streamUrl: string; streamToken: string };
export type Me = { email: string };
export type ErrorBody = { error: string; message: string };
