import Mobilerun from '@mobilerun/sdk';
import index from '../index.html';
import { createApiApp } from './server/api-app';
import { readServerConfig } from './server/config';
import { createPortalService } from './server/portal-service';
import { createPortalStore } from './server/store';

const HOST = '127.0.0.1'; // local by design; change it deliberately when you deploy

const config = readServerConfig(process.env);
const { apiKey, baseURL } = config;
const store = createPortalStore(config.databasePath);
const service = apiKey ? createPortalService(new Mobilerun({ apiKey, baseURL }), store) : null;
if (!service) {
  console.warn('MOBILERUN_CLOUD_API_KEY is not set: the page loads, but API requests answer 503.');
}
if (config.sessionSecretGenerated) {
  console.warn('SESSION_SECRET is not set. Using a random secret: sessions reset on restart.');
}

const app = createApiApp({
  service,
  store,
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

console.log(`Tenant portal: http://${HOST}:${config.port}`);
