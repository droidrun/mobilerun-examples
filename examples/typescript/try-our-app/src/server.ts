import Mobilerun from '@mobilerun/sdk';
import { z } from 'zod';
import index from '../index.html';
import { createApiApp } from './server/api-app';
import { createRateLimiter } from './server/rate-limiter';
import { createSessionService } from './server/session-service';
import { createSessionStore } from './server/session-store';

// Knobs a reader rarely needs are constants; the rest comes from .env.
const HOST = '127.0.0.1';
const PROVISION_TIMEOUT_MS = 120_000;
const REAPER_INTERVAL_MS = 15_000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000;
const DB_PATH = 'data/demo-sessions.sqlite';

const int = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const androidPackage = /^[A-Za-z]\w*(\.[A-Za-z]\w*)+$/;
const config = z
  .object({
    MOBILERUN_CLOUD_API_KEY: z.string().optional(),
    MOBILERUN_API_URL: z.url().optional(),
    PORT: int(1, 65_535, 3_000),
    DEMO_APP_PACKAGE: z.string().regex(androidPackage).default('com.android.chrome'),
    SESSION_TTL_SECONDS: int(10, 3_600, 300),
    MAX_CONCURRENT_SESSIONS: int(1, 100, 3),
    RATE_LIMIT_MAX: int(1, 1_000, 3),
  })
  // An empty `FOO=` line in .env counts as unset.
  .parse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value?.trim())));
const production = process.env.NODE_ENV === 'production';

// Like task-runner: the API URL works with or without its /v1 suffix.
const apiUrl = config.MOBILERUN_API_URL?.replace(/\/+$/, '');
const baseURL = apiUrl && !apiUrl.endsWith('/v1') ? `${apiUrl}/v1` : apiUrl;
const apiKey = config.MOBILERUN_CLOUD_API_KEY;

const store = createSessionStore(DB_PATH);
const service = apiKey
  ? createSessionService({
      client: new Mobilerun({ apiKey, baseURL }),
      store,
      appPackage: config.DEMO_APP_PACKAGE,
      ttlMs: config.SESSION_TTL_SECONDS * 1_000,
      provisionTimeoutMs: PROVISION_TIMEOUT_MS,
      maxConcurrent: config.MAX_CONCURRENT_SESSIONS,
    })
  : null;
if (!service) console.warn('MOBILERUN_CLOUD_API_KEY is not set: demos cannot start.');

const app = createApiApp({
  service,
  limiter: createRateLimiter({ max: config.RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS }),
  // Random per start, so visitor cookies reset on restart. Replace the anonymous
  // cookie with your own authentication before production.
  cookieSecret: crypto.randomUUID(),
  secureCookies: production,
});

const server = Bun.serve({
  hostname: HOST,
  port: config.PORT,
  // POST /api/sessions answers once the phone is ready. Bun's default 10 s idle
  // timeout would drop it ("Failed to fetch" in the browser); 255 s is Bun's
  // maximum and covers the 120 s boot timeout.
  idleTimeout: 255,
  routes: { '/': index },
  fetch: (request, bunServer) => app.fetch(request, { server: bunServer }),
  development: production ? false : { hmr: true, console: true },
});

// Sweep now (a restart may have left expired demos or owed terminates), then on a timer.
const reaper = service ? setInterval(() => void service.reap(), REAPER_INTERVAL_MS) : undefined;
void service?.reap();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: ending live demos…`);
  clearInterval(reaper);
  await server.stop(true);
  await service?.shutdown();
  store.close();
  process.exit(0);
}
const onSignal = (signal: NodeJS.Signals) => void shutdown(signal);
process.on('SIGINT', onSignal).on('SIGTERM', onSignal);

// `bun --hot` re-runs this file on save: drop the old timer and handlers first.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearInterval(reaper);
    process.off('SIGINT', onSignal).off('SIGTERM', onSignal);
  });
}

console.log(`Live demo: http://${HOST}:${config.PORT}`);
