import Mobilerun from '@mobilerun/sdk';
import { z } from 'zod';
import index from '../index.html';
import { createApiApp } from './server/api-app';
import { createAssistantService } from './server/assistant-service';
import { createLedger } from './server/ledger';

// Knobs a reader rarely needs are constants; the rest comes from .env.
const HOST = '127.0.0.1';
const POLL_INTERVAL_MS = 3_000;
const production = process.env.NODE_ENV === 'production';

const credits = (min: number, fallback: number) =>
  z.coerce.number().int().min(min).default(fallback);
const secret = z.string().min(32, 'SESSION_SECRET needs at least 32 characters');
const config = z
  .object({
    MOBILERUN_CLOUD_API_KEY: z.string().optional(),
    MOBILERUN_API_URL: z.url().optional(),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
    // Signs the stub session cookie. Production needs a stable one.
    SESSION_SECRET: production ? secret : secret.optional(),
    DEVICE_IDS: z
      .string()
      .default('')
      .transform((value) => [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))])
      .pipe(z.array(z.uuid())),
    STARTING_BUDGET: credits(0, 100),
    RESERVE_PER_RUN: credits(1, 20),
    DATABASE_PATH: z.string().default('data/ledger.sqlite'),
  })
  // An empty `FOO=` line in .env counts as unset.
  .parse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value?.trim())));

// Like task-runner: the API URL works with or without its /v1 suffix.
const apiUrl = config.MOBILERUN_API_URL?.replace(/\/+$/, '');
const baseURL = apiUrl && !apiUrl.endsWith('/v1') ? `${apiUrl}/v1` : apiUrl;
const apiKey = config.MOBILERUN_CLOUD_API_KEY;

const service = createAssistantService({
  client: apiKey ? new Mobilerun({ apiKey, baseURL }) : null,
  ledger: createLedger(config.DATABASE_PATH, config.STARTING_BUDGET),
  deviceIds: config.DEVICE_IDS,
  reservePerRun: config.RESERVE_PER_RUN,
  pollIntervalMs: POLL_INTERVAL_MS,
});
service.resume();

if (!apiKey) console.warn('MOBILERUN_CLOUD_API_KEY is not set: requests cannot start.');
if (!config.DEVICE_IDS.length) console.warn('DEVICE_IDS is empty: add a cloud phone id.');
if (!config.SESSION_SECRET) console.warn('SESSION_SECRET is not set: sessions reset on restart.');

const app = createApiApp({
  service,
  sessionSecret: config.SESSION_SECRET ?? `${crypto.randomUUID()}${crypto.randomUUID()}`,
  secureCookies: production,
});

Bun.serve({
  hostname: HOST,
  port: config.PORT,
  routes: { '/': index },
  fetch: app.fetch,
  development: production ? false : { hmr: true, console: true },
});

console.log(`Fernly Concierge: http://${HOST}:${config.PORT}`);
