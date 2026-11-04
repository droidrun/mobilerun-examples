import { z } from 'zod';

export const DEV_SESSION_SECRET =
  'development-only-secret-change-me-before-deploying';

const serverConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1).optional(),
    apiUrl: z.url().optional(),
    host: z.literal('127.0.0.1'),
    port: z.coerce.number().int().min(1).max(65_535),
    production: z.boolean(),
    sessionSecret: z
      .string({ error: 'SESSION_SECRET is required.' })
      .min(32, 'SESSION_SECRET must be at least 32 characters.'),
    databasePath: z.string().trim().min(1),
    // The schema stores one device per user, so the quota is 0 (provisioning
    // closed) or 1. Supporting more means dropping the unique index on
    // devices.user_id and adding a device id to the routes.
    maxDevicesPerUser: z.coerce.number().int().min(0).max(1),
    adminEmails: z.array(z.email()),
  })
  .refine(
    (config) => !(config.production && config.sessionSecret === DEV_SESSION_SECRET),
    {
      path: ['sessionSecret'],
      message: 'Replace the development SESSION_SECRET before production.',
    },
  );

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export function normalizeApiBaseUrl(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\/+$/, '');
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
}

export function parseEmailList(value: string | undefined): Array<string> {
  return (value ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

export function readServerConfig(
  environment: Record<string, string | undefined>,
): ServerConfig {
  return serverConfigSchema.parse({
    apiKey: environment.MOBILERUN_API_KEY,
    apiUrl: normalizeApiBaseUrl(environment.MOBILERUN_API_URL),
    host: '127.0.0.1',
    port: environment.PORT ?? 3_000,
    production: environment.NODE_ENV === 'production',
    sessionSecret: environment.SESSION_SECRET,
    databasePath: environment.DATABASE_PATH ?? './data/portal.sqlite',
    maxDevicesPerUser: environment.MAX_DEVICES_PER_USER ?? 1,
    adminEmails: parseEmailList(environment.ADMIN_EMAILS),
  });
}
