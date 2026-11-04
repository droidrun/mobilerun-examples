import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const serverConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1).optional(),
    apiUrl: z.url().optional(),
    host: z.literal('127.0.0.1'),
    port: z.coerce.number().int().min(1).max(65_535),
    production: z.boolean(),
    sessionSecret: z
      .string()
      .min(32, 'SESSION_SECRET must be at least 32 characters.')
      .optional(),
    databasePath: z.string().trim().min(1),
  })
  .refine((config) => !config.production || config.sessionSecret, {
    path: ['sessionSecret'],
    message: 'SESSION_SECRET is required in production (openssl rand -hex 32).',
  });

export type ServerConfig = Omit<
  z.infer<typeof serverConfigSchema>,
  'sessionSecret'
> & {
  sessionSecret: string;
  /** True when no SESSION_SECRET was set and a random one was generated. */
  sessionSecretGenerated: boolean;
};

export function normalizeApiBaseUrl(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\/+$/, '');
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
}

export function readServerConfig(
  environment: Record<string, string | undefined>,
): ServerConfig {
  const { sessionSecret, ...config } = serverConfigSchema.parse({
    apiKey: environment.MOBILERUN_CLOUD_API_KEY,
    apiUrl: normalizeApiBaseUrl(environment.MOBILERUN_API_URL),
    host: '127.0.0.1',
    port: environment.PORT ?? 3_000,
    production: environment.NODE_ENV === 'production',
    // An empty value (as in .env.example) counts as unset.
    sessionSecret: environment.SESSION_SECRET?.trim() || undefined,
    databasePath: environment.DATABASE_PATH ?? './data/portal.sqlite',
  });
  return {
    ...config,
    sessionSecret: sessionSecret ?? randomBytes(32).toString('hex'),
    sessionSecretGenerated: sessionSecret === undefined,
  };
}
