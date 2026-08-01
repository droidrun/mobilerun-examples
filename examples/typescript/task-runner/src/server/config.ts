import { z } from 'zod';

const serverConfigSchema = z.object({
  apiKey: z.string().trim().min(1).optional(),
  apiUrl: z.url().optional(),
  host: z.literal('127.0.0.1'),
  port: z.coerce.number().int().min(1).max(65_535),
  production: z.boolean(),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

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
  return serverConfigSchema.parse({
    apiKey: environment.MOBILERUN_CLOUD_API_KEY,
    apiUrl: normalizeApiBaseUrl(environment.MOBILERUN_API_URL),
    host: '127.0.0.1',
    port: environment.PORT ?? 3_000,
    production: environment.NODE_ENV === 'production',
  });
}
