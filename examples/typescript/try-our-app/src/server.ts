import Mobilerun from '@mobilerun/sdk';
import index from '../index.html';
import { createApiApp } from './server/api-app';
import {
  PROVISION_TIMEOUT_MS,
  RATE_LIMIT_WINDOW_MS,
  REAPER_INTERVAL_MS,
  SESSIONS_DB_PATH,
  readServerConfig,
} from './server/config';
import { createMobilerunDeviceDeps } from './server/mobilerun-adapter';
import { createRateLimiter } from './server/rate-limiter';
import { createSessionService } from './server/session-service';
import { createSessionStore } from './server/session-store';

const config = readServerConfig(process.env);

const store = createSessionStore(SESSIONS_DB_PATH);
const service = config.apiKey
  ? createSessionService({
      deps: createMobilerunDeviceDeps(
        new Mobilerun({
          apiKey: config.apiKey,
          ...(config.apiUrl ? { baseURL: config.apiUrl } : {}),
        }),
      ),
      store,
      appPackage: config.appPackage,
      ttlMs: config.sessionTtlMs,
      provisionTimeoutMs: PROVISION_TIMEOUT_MS,
      maxConcurrent: config.maxConcurrentSessions,
    })
  : null;

const app = createApiApp({
  service,
  limiter: createRateLimiter({
    max: config.rateLimitMax,
    windowMs: RATE_LIMIT_WINDOW_MS,
  }),
  // Random per start: visitor cookies reset on restart. Replace the anonymous
  // cookie with your own authentication before production.
  cookieSecret: crypto.randomUUID(),
  secureCookies: config.production,
});

if (!service) {
  console.warn(
    'MOBILERUN_CLOUD_API_KEY is not set. The page will load, but demos cannot start.',
  );
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  // POST /api/sessions answers only once the phone is ready, which can take
  // longer than Bun's default 10 s idle timeout; that would drop the
  // connection and the browser would see "Failed to fetch" instead of JSON.
  // 255 s is Bun's maximum and covers the 120 s boot timeout.
  idleTimeout: 255,
  routes: {
    '/': index,
  },
  fetch: (request, bunServer) => app.fetch(request, { server: bunServer }),
  development: config.production
    ? false
    : {
        hmr: true,
        console: true,
      },
});

// Sweep now (a restart may have left expired demos) and then on a timer.
const reaper = service
  ? setInterval(() => void service.reap(), REAPER_INTERVAL_MS)
  : null;
void service?.reap();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: ending live demos…`);
  if (reaper) clearInterval(reaper);
  await server.stop(true);
  await service?.shutdown();
  store.close();
  process.exit(0);
}

const onSigint = () => void shutdown('SIGINT');
const onSigterm = () => void shutdown('SIGTERM');
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (reaper) clearInterval(reaper);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  });
}

console.log(`Live demo: http://${config.host}:${config.port}`);
