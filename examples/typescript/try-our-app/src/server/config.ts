import { z } from 'zod';

const seconds = (fallback: number, min = 1) =>
  z.coerce
    .number()
    .int()
    .min(min)
    .max(86_400)
    .default(fallback)
    .transform((value) => value * 1_000);

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
  sessionTtlMs: seconds(300, 10),
  reaperIntervalMs: seconds(15),
  provisionTimeoutMs: seconds(120, 10),
  maxConcurrentSessions: z.coerce.number().int().min(1).max(100),
  rateLimitMax: z.coerce.number().int().min(1).max(1_000),
  rateLimitWindowMs: seconds(3_600),
  cookieSecret: z.string().min(16).optional(),
  sessionsDbPath: z.string().min(1),
  brandFile: z.string().min(1),
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
    sessionTtlMs: read('SESSION_TTL_SECONDS'),
    reaperIntervalMs: read('REAPER_INTERVAL_SECONDS'),
    provisionTimeoutMs: read('PROVISION_TIMEOUT_SECONDS'),
    maxConcurrentSessions: read('MAX_CONCURRENT_SESSIONS') ?? 3,
    rateLimitMax: read('RATE_LIMIT_MAX') ?? 3,
    rateLimitWindowMs: read('RATE_LIMIT_WINDOW_SECONDS'),
    cookieSecret: read('COOKIE_SECRET'),
    sessionsDbPath: read('SESSIONS_DB_PATH') ?? 'data/sessions.sqlite',
    brandFile: read('BRAND_FILE') ?? 'brand.json',
  });
}
