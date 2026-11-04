import { z } from 'zod';

export const loginRequestSchema = z
  .object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) })
  .strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionSchema = z.object({
  email: z.string().min(1),
});

export type Session = z.infer<typeof sessionSchema>;

export const deviceActionSchema = z.enum(['stop', 'resume', 'reboot', 'reset']);

export type DeviceAction = z.infer<typeof deviceActionSchema>;

// What the end user sees about their own device. The Mobilerun device id never
// leaves the server.
export const deviceViewSchema = z.object({
  state: z.string().min(1),
  stateMessage: z.string(),
  createdAt: z.string(),
});

export type DeviceView = z.infer<typeof deviceViewSchema>;

export const streamCredentialsSchema = z.object({
  streamUrl: z.string().min(1),
  streamToken: z.string().min(1),
});

export type StreamCredentials = z.infer<typeof streamCredentialsSchema>;

export const healthSchema = z.object({
  ok: z.boolean(),
  sdkConfigured: z.boolean(),
});

export type Health = z.infer<typeof healthSchema>;

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
