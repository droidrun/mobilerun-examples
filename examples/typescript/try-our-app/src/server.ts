import Mobilerun from '@mobilerun/sdk';
import index from '../index.html';
import { createApiApp } from './server/api-app';
import { readServerConfig } from './server/config';
import { createRateLimiter } from './server/rate-limiter';
import { createSessionService } from './server/session-service';
import { createSessionStore } from './server/session-store';

// Knobs a reader rarely needs are constants; the rest comes from .env (config.ts).
const HOST = '127.0.0.1'; // local by design; change it deliberately when you deploy
const PROVISION_TIMEOUT_MS = 120_000;
const REAPER_INTERVAL_MS = 15_000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000;
const DB_PATH = 'data/demo-sessions.sqlite';

const config = readServerConfig(process.env);
const { apiKey, baseURL } = config;
const store = createSessionStore(DB_PATH);
const service = apiKey
  ? createSessionService({
      client: new Mobilerun({ apiKey, baseURL }),
      store,
      appPackage: config.appPackage,
      ttlMs: config.ttlMs,
      provisionTimeoutMs: PROVISION_TIMEOUT_MS,
      maxConcurrent: config.maxConcurrent,
    })
  : null;
if (!service) {
  console.warn('MOBILERUN_CLOUD_API_KEY is not set: the page loads, but API requests answer 503.');
}
if (config.sessionSecretGenerated) {
  console.warn('SESSION_SECRET is not set. Using a random secret: sessions reset on restart.');
}

const app = createApiApp({
  service,
  limiter: createRateLimiter({ max: config.rateLimitMax, windowMs: RATE_LIMIT_WINDOW_MS }),
  sessionSecret: config.sessionSecret,
  secureCookies: config.production,
});

const server = Bun.serve({
  hostname: HOST,
  port: config.port,
  // POST /api/sessions answers once the phone is ready. Bun's default 10 s idle
  // timeout would drop it ("Failed to fetch" in the browser); 255 s is Bun's
  // maximum and covers the 120 s boot timeout.
  idleTimeout: 255,
  routes: { '/': index },
  fetch: (request, bunServer) => app.fetch(request, { server: bunServer }),
  development: config.production ? false : { hmr: true, console: true },
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

console.log(`Live demo: http://${HOST}:${config.port}`);
