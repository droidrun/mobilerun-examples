import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const deviceIdsSchema = z.array(z.uuid());

const serverConfigSchema = z.object({
  apiKey: z.string().trim().min(1).optional(),
  apiUrl: z.url().optional(),
  host: z.literal('127.0.0.1'),
  port: z.coerce.number().int().min(1).max(65_535),
  production: z.boolean(),
  sessionSecret: z.string().min(32),
  ephemeralSessionSecret: z.boolean(),
  deviceIds: deviceIdsSchema,
  startingBudget: z.coerce.number().int().min(0),
  reservePerRun: z.coerce.number().int().min(1),
  databasePath: z.string().trim().min(1),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export function normalizeApiBaseUrl(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\/+$/, '');
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
}

export function parseDeviceIds(value: string | undefined): Array<string> {
  const ids = (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

function blankToUndefined(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

export function readServerConfig(
  environment: Record<string, string | undefined>,
): ServerConfig {
  const production = environment.NODE_ENV === 'production';
  const configuredSecret = blankToUndefined(environment.SESSION_SECRET);
  // Development only: a throwaway secret signs cookies until the next restart.
  // Production must configure a stable one, so this never applies there.
  const ephemeral = !configuredSecret && !production;

  return serverConfigSchema.parse({
    apiKey: blankToUndefined(environment.MOBILERUN_API_KEY),
    apiUrl: normalizeApiBaseUrl(blankToUndefined(environment.MOBILERUN_API_URL)),
    host: '127.0.0.1',
    port: environment.PORT ?? 3_000,
    production,
    sessionSecret: ephemeral
      ? `${randomUUID()}${randomUUID()}`
      : configuredSecret,
    ephemeralSessionSecret: ephemeral,
    deviceIds: parseDeviceIds(environment.DEVICE_IDS),
    startingBudget: blankToUndefined(environment.STARTING_BUDGET) ?? 100,
    reservePerRun: blankToUndefined(environment.RESERVE_PER_RUN) ?? 20,
    databasePath:
      blankToUndefined(environment.DATABASE_PATH) ?? 'data/ledger.sqlite',
  });
}
