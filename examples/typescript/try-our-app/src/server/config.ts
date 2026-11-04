import { z } from 'zod';

// Operational knobs that rarely need changing are constants, not env vars.
export const REAPER_INTERVAL_MS = 15_000;
export const PROVISION_TIMEOUT_MS = 120_000;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000;
export const SESSIONS_DB_PATH = 'data/sessions.sqlite';

const serverConfigSchema = z.object({
  apiKey: z.string().trim().min(1).optional(),
  apiUrl: z.url().optional(),
  host: z.literal('127.0.0.1'),
  port: z.coerce.number().int().min(1).max(65_535),
  production: z.boolean(),
  appPackage: z
    .string()
    .regex(
      /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/,
      'DEMO_APP_PACKAGE must be an Android package name.',
    ),
  sessionTtlMs: z.coerce
    .number()
    .int()
    .min(10)
    .max(3_600)
    .transform((seconds) => seconds * 1_000),
  maxConcurrentSessions: z.coerce.number().int().min(1).max(100),
  rateLimitMax: z.coerce.number().int().min(1).max(1_000),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export function normalizeApiBaseUrl(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\/+$/, '');
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
}

/** An empty `FOO=` line in `.env` should behave like an unset variable. */
function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

export function readServerConfig(
  environment: Record<string, string | undefined>,
): ServerConfig {
  const read = (name: string) => present(environment[name]);
  return serverConfigSchema.parse({
    apiKey: read('MOBILERUN_CLOUD_API_KEY'),
    apiUrl: normalizeApiBaseUrl(read('MOBILERUN_API_URL')),
    host: '127.0.0.1',
    port: read('PORT') ?? 3_000,
    production: environment.NODE_ENV === 'production',
    appPackage: read('DEMO_APP_PACKAGE') ?? 'com.android.chrome',
    sessionTtlMs: read('SESSION_TTL_SECONDS') ?? 300,
    maxConcurrentSessions: read('MAX_CONCURRENT_SESSIONS') ?? 3,
    rateLimitMax: read('RATE_LIMIT_MAX') ?? 3,
  });
}
