import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { DEVICE_ACTIONS, type ErrorBody } from '@/shared/contracts';
import { PortalError, type PortalService } from './portal';
import { createSessions } from './session';
import type { PortalStore, User } from './store';

type Env = { Variables: { user: User; service: PortalService } };
type Options = {
  service: PortalService | null; // null while MOBILERUN_CLOUD_API_KEY is not set
  store: PortalStore;
  sessionSecret: string;
  production: boolean;
};
type ApiError = { status?: unknown; error?: { message?: unknown; detail?: unknown } | null };

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const SOMETHING_WRONG = 'Something went wrong. Please try again.';

/**
 * The one error mapping. Own refusals keep their status and text. A Mobilerun 4xx (an
 * unavailable device type, an insufficient balance) keeps its status and the API's text. A
 * 401/403 means the portal's own key is wrong, not the user's session: like any other failure
 * it becomes a plain 502.
 */
function toError(error: unknown): [number, ErrorBody] {
  if (error instanceof PortalError) {
    return [error.status, { error: error.code, message: error.message }];
  }
  if (error instanceof HTTPException) {
    return [error.status, { error: 'request_rejected', message: 'Request rejected.' }];
  }
  console.error('request failed', error);
  const { status, error: body } = (error ?? {}) as ApiError;
  if (typeof status !== 'number' || status < 400 || status >= 500 || [401, 403].includes(status)) {
    return [502, { error: 'upstream_error', message: SOMETHING_WRONG }];
  }
  const text = [body?.message, body?.detail].find((value) => typeof value === 'string' && value);
  return [status, { error: 'upstream_rejected', message: (text as string) ?? SOMETHING_WRONG }];
}

export function createApiApp({ service, store, sessionSecret, production }: Options) {
  const app = new Hono<Env>();
  const sessions = createSessions(sessionSecret, production);

  app.use('/api/*', csrf(), async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  const signedIn = createMiddleware<Env>(async (c, next) => {
    const userId = await sessions.userId(c);
    const user = userId === null ? undefined : store.findUser(userId);
    if (!user) throw new PortalError('unauthenticated', 401, 'Sign in to continue.');
    c.set('user', user);
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true, sdkConfigured: service !== null }));

  // STUB: any well-formed email signs in as that user. Delete this route and replace
  // session.ts together with it when you wire your identity provider.
  app.post('/api/login', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
    const email = emailSchema.safeParse(body?.email);
    if (!email.success) throw new PortalError('invalid_request', 400, 'Enter a valid email.');
    const user = store.upsertUser(email.data);
    await sessions.start(c, user.id);
    return c.json({ email: user.email });
  });
  app.post('/api/logout', (c) => {
    sessions.end(c);
    return c.json({ ok: true });
  });
  app.get('/api/me', signedIn, (c) => c.json({ email: c.var.user.email }));

  // Every device route needs a user and a configured key. The service looks the device up
  // from that user's row; nothing in the request selects it.
  app.use('/api/device/*', signedIn, async (c, next) => {
    if (!service) {
      throw new PortalError('missing_api_key', 500, 'Phones are not set up on this server yet.');
    }
    c.set('service', service);
    await next();
  });
  app.post('/api/device', async (c) => c.json(await c.var.service.create(c.var.user.id), 201));
  app.get('/api/device', async (c) => c.json(await c.var.service.get(c.var.user.id)));
  app.get('/api/device/stream', async (c) => c.json(await c.var.service.stream(c.var.user.id)));
  app.delete('/api/device', async (c) => {
    await c.var.service.terminate(c.var.user.id);
    return c.body(null, 204);
  });
  app.post('/api/device/:action', async (c) => {
    const action = DEVICE_ACTIONS.find((name) => name === c.req.param('action'));
    if (!action) throw new PortalError('not_found', 404, 'Not found.');
    await c.var.service.act(c.var.user.id, action);
    return c.json({ ok: true }, 202);
  });

  app.notFound((c) => c.json({ error: 'not_found', message: 'Not found.' }, 404));
  app.onError((error, c) => {
    const [status, body] = toError(error);
    return c.json(body, status as ContentfulStatusCode);
  });
  return app;
}
