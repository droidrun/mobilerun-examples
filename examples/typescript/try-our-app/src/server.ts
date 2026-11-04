import Mobilerun from '@mobilerun/sdk';
import index from '../index.html';
import { createApiApp } from './server/api-app';
import { loadBrand } from './server/brand';
import { readServerConfig } from './server/config';
import { createMobilerunDeviceDeps } from './server/mobilerun-adapter';
import { createRateLimiter } from './server/rate-limiter';
import { createSessionService } from './server/session-service';
import { createSessionStore } from './server/session-store';

const config = readServerConfig(process.env);
const brand = loadBrand(config.brandFile);

const store = createSessionStore(config.sessionsDbPath);
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
      provisionTimeoutMs: config.provisionTimeoutMs,
      maxConcurrent: config.maxConcurrentSessions,
    })
  : null;

if (!config.cookieSecret) {
  console.warn(
    'COOKIE_SECRET is not set. Using a random secret; visitor cookies reset on restart.',
  );
}

const app = createApiApp({
  service,
  brand,
  limiter: createRateLimiter({
    max: config.rateLimitMax,
    windowMs: config.rateLimitWindowMs,
  }),
  cookieSecret: config.cookieSecret ?? crypto.randomUUID(),
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

// Sweep expired demos now (a restart may have left some) and then on a timer.
const reaper = service
  ? setInterval(() => void service.reap(), config.reaperIntervalMs)
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

console.log(`${brand.name} live demo: http://${config.host}:${config.port}`);
