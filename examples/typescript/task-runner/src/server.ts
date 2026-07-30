import Mobilerun from '@mobilerun/sdk';
import index from '../index.html';
import { createApiApp } from './server/api-app';
import { readServerConfig } from './server/config';
import { createMobilerunTaskDeps } from './server/mobilerun-adapter';
import { createRunSessionStore } from './server/run-session-store';
import { createTaskService } from './server/task-service';

const config = readServerConfig(process.env);
const service = config.apiKey
  ? createTaskService(
      createMobilerunTaskDeps(
        new Mobilerun({
          apiKey: config.apiKey,
          ...(config.apiUrl ? { baseURL: config.apiUrl } : {}),
        }),
      ),
      createRunSessionStore(),
    )
  : null;
const app = createApiApp({ service });

if (!service) {
  console.warn(
    'MOBILERUN_CLOUD_API_KEY is not set. The UI will load, but tasks cannot start.',
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

console.log(`Mobilerun Task Runner: http://${config.host}:${config.port}`);
