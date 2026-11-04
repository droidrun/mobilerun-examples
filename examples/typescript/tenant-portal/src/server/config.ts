import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  MOBILERUN_CLOUD_API_KEY: z.string().optional(),
  MOBILERUN_API_URL: z.url().optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters.').optional(),
  DATABASE_PATH: z.string().default('./data/portal.sqlite'),
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
    databasePath: config.DATABASE_PATH,
  };
}
