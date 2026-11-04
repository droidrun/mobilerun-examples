import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb color.');

const httpUrl = z
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Use an http(s) URL.');

export const brandSchema = z.object({
  name: z.string().trim().min(1).max(60),
  tagline: z.string().trim().min(1).max(160),
  headline: z.string().trim().min(1).max(80),
  pitch: z.string().trim().min(1).max(320),
  logoSvg: z
    .string()
    .trim()
    .max(8_000)
    .refine((value) => value.startsWith('<svg'), 'Provide an inline <svg>.'),
  getAppUrl: httpUrl,
  colors: z.object({
    primary: hexColor,
    primaryForeground: hexColor,
    background: hexColor,
    foreground: hexColor,
    card: hexColor,
    muted: hexColor,
    mutedForeground: hexColor,
    border: hexColor,
  }),
});

export type Brand = z.infer<typeof brandSchema>;

export const healthSchema = z.object({
  ok: z.boolean(),
  sdkConfigured: z.boolean(),
});

export type Health = z.infer<typeof healthSchema>;

export const sessionViewSchema = z.object({
  id: z.uuid(),
  expiresAt: z.string().min(1),
  serverTime: z.string().min(1),
});

export type SessionView = z.infer<typeof sessionViewSchema>;

export const streamViewSchema = z.object({
  streamUrl: z.string().min(1),
  streamToken: z.string().min(1).optional(),
});

export type StreamView = z.infer<typeof streamViewSchema>;

export const endSessionResponseSchema = z.object({
  ended: z.boolean(),
});

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
