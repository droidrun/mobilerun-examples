import Mobilerun from '@mobilerun/sdk';
import index from '../index.html';
import { createApiApp } from './server/api-app';
import { readServerConfig } from './server/config';
import { createMobilerunPortalDeps } from './server/mobilerun-adapter';
import { createPortalService } from './server/portal-service';
import { createPortalStore } from './server/store';

const config = readServerConfig(process.env);
const store = createPortalStore(config.databasePath);
const service = config.apiKey
  ? createPortalService(
      createMobilerunPortalDeps(
        new Mobilerun({
          apiKey: config.apiKey,
          ...(config.apiUrl ? { baseURL: config.apiUrl } : {}),
        }),
      ),
      store,
      { maxDevicesPerUser: config.maxDevicesPerUser },
    )
  : null;
const app = createApiApp({
  service,
  store,
  sessionSecret: config.sessionSecret,
  production: config.production,
  adminEmails: config.adminEmails,
});

if (!service) {
  console.warn(
    'MOBILERUN_API_KEY is not set. The UI will load, but devices cannot be managed.',
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

console.log(`Kestrel MyPhone portal: http://${config.host}:${config.port}`);
