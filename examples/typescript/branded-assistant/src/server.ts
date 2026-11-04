import Mobilerun from '@mobilerun/sdk';
import index from '../index.html';
import { assistantConfig } from './server/assistant-config';
import { createAssistantService } from './server/assistant-service';
import { createApiApp } from './server/api-app';
import { readServerConfig } from './server/config';
import { createLedger } from './server/ledger';
import { createMobilerunAssistantDeps } from './server/mobilerun-adapter';

const config = readServerConfig(process.env);
const ledger = createLedger(config.databasePath, config.startingBudget);
const service = createAssistantService({
  ledger,
  deps: config.apiKey
    ? createMobilerunAssistantDeps(
        new Mobilerun({
          apiKey: config.apiKey,
          ...(config.apiUrl ? { baseURL: config.apiUrl } : {}),
        }),
      )
    : null,
  assistant: assistantConfig,
  deviceIds: config.deviceIds,
  reservePerRun: config.reservePerRun,
  pollIntervalMs: 3_000,
});
service.resume();

const app = createApiApp({
  service,
  sessionSecret: config.sessionSecret,
  production: config.production,
});

if (!config.apiKey) {
  console.warn(
    'MOBILERUN_API_KEY is not set. The UI will load, but requests cannot start.',
  );
}
if (config.deviceIds.length === 0) {
  console.warn('DEVICE_IDS is empty. Add at least one cloud phone id.');
}
if (config.ephemeralSessionSecret) {
  console.warn(
    'SESSION_SECRET is not set. Using a throwaway secret: sessions reset on restart.',
  );
}

Bun.serve({
  hostname: config.host,
  port: config.port,
  routes: {
    '/': index,
  },
  fetch: app.fetch,
  development: config.production
    ? false
    : {
        hmr: true,
        console: true,
      },
});

console.log(`Branded assistant: http://${config.host}:${config.port}`);
