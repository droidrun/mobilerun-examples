import Mobilerun from '@mobilerun/sdk';
import index from '../index.html';
import { createApiApp } from './server/api-app';
import { createAssistantService } from './server/assistant-service';
import { readServerConfig } from './server/config';
import { createLedger } from './server/ledger';

// Knobs a reader rarely needs are constants; the rest comes from .env (config.ts).
const HOST = '127.0.0.1'; // local by design; change it deliberately when you deploy
const POLL_INTERVAL_MS = 3_000;

const config = readServerConfig(process.env);
const { apiKey, baseURL } = config;
const service = createAssistantService({
  client: apiKey ? new Mobilerun({ apiKey, baseURL }) : null,
  ledger: createLedger(config.databasePath, config.startingBudget),
  deviceIds: config.deviceIds,
  reservePerRun: config.reservePerRun,
  pollIntervalMs: POLL_INTERVAL_MS,
});
service.resume();
if (!apiKey) {
  console.warn('MOBILERUN_CLOUD_API_KEY is not set: the page loads, but API requests answer 503.');
}
if (config.sessionSecretGenerated) {
  console.warn('SESSION_SECRET is not set. Using a random secret: sessions reset on restart.');
}
if (!config.deviceIds.length) console.warn('DEVICE_IDS is empty: add a cloud phone id.');

const app = createApiApp({
  service,
  sessionSecret: config.sessionSecret,
  secureCookies: config.production,
});

Bun.serve({
  hostname: HOST,
  port: config.port,
  routes: { '/': index },
  fetch: app.fetch,
  development: config.production ? false : { hmr: true, console: true },
});

console.log(`Fernly Concierge: http://${HOST}:${config.port}`);
