import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const int = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const androidPackage = /^[A-Za-z]\w*(\.[A-Za-z]\w*)+$/;

const schema = z.object({
  MOBILERUN_CLOUD_API_KEY: z.string().optional(),
  MOBILERUN_API_URL: z.url().optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters.').optional(),
  DEMO_APP_PACKAGE: z.string().regex(androidPackage).default('com.android.chrome'),
  SESSION_TTL_SECONDS: int(10, 3_600, 300),
  MAX_CONCURRENT_SESSIONS: int(1, 100, 3),
  RATE_LIMIT_MAX: int(1, 1_000, 3),
});

/** Reads the environment. An empty `FOO=` line, as in .env.example, counts as unset. */
export function readServerConfig(env: Record<string, string | undefined>) {
  const config = schema.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v?.trim())));
  const production = env.NODE_ENV === 'production';
  const secret = config.SESSION_SECRET;
  if (production && !secret) {
    throw new Error('SESSION_SECRET is required in production (openssl rand -hex 32).');
  }
  // Like task-runner: the API URL works with or without its /v1 suffix.
  const apiUrl = config.MOBILERUN_API_URL?.replace(/\/+$/, '');
  return {
    apiKey: config.MOBILERUN_CLOUD_API_KEY,
    baseURL: apiUrl && !apiUrl.endsWith('/v1') ? `${apiUrl}/v1` : apiUrl,
    port: config.PORT,
    production,
    // Outside production an unset secret is random per process: sessions reset on restart.
    sessionSecret: secret ?? randomBytes(32).toString('hex'),
    sessionSecretGenerated: !secret,
    appPackage: config.DEMO_APP_PACKAGE,
    ttlMs: config.SESSION_TTL_SECONDS * 1_000,
    maxConcurrent: config.MAX_CONCURRENT_SESSIONS,
    rateLimitMax: config.RATE_LIMIT_MAX,
  };
}
