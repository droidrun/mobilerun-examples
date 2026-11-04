import { Hono, type Context } from 'hono';
import { csrf } from 'hono/csrf';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { DEVICE_ACTIONS, type ErrorBody } from '@/shared/contracts';
import { PortalError, type PortalService } from './portal-service';
import { createSessions } from './session';
import type { PortalStore, User } from './store';

type Env = { Variables: { user: User; service: PortalService } };
type Options = {
  service: PortalService | null; // null while MOBILERUN_CLOUD_API_KEY is not set
  store: PortalStore;
  sessionSecret: string;
  secureCookies?: boolean;
};
type UpstreamError = { status?: unknown; error?: Record<string, unknown> | null };

const SOMETHING_WRONG = 'Something went wrong. Please try again.';
const NOT_SET_UP = 'This service is not set up yet. Please try again later.';
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/**
 * The one error mapping. Own refusals keep their status and text. An API 4xx (an unavailable
 * device type, an insufficient balance) keeps its status and the API's text. A 401/403 means
 * this server's key is wrong, not the user's session: like a 5xx it becomes a plain 502.
 * Anything else, a thrown non-Error included, is a plain 500.
 */
function toError(error: unknown): { status: ContentfulStatusCode; body: ErrorBody } {
  if (error instanceof PortalError) {
    return { status: error.status, body: { error: error.code, message: error.message } };
  }
  if (error instanceof HTTPException) {
    const body = { error: 'request_rejected', message: 'Request rejected.' };
    return { status: error.status, body };
  }
  console.error('request failed', error);
  const { status, error: body } = (error ?? {}) as UpstreamError;
  if (typeof status !== 'number' || status < 400 || status >= 600) {
    return { status: 500, body: { error: 'internal_error', message: SOMETHING_WRONG } };
  }
  if (status >= 500 || status === 401 || status === 403) {
    return { status: 502, body: { error: 'upstream_error', message: SOMETHING_WRONG } };
  }
  const text = [body?.message, body?.detail].find((v) => typeof v === 'string' && v);
  const message = typeof text === 'string' ? text : SOMETHING_WRONG;
  return { status: status as ContentfulStatusCode, body: { error: 'upstream_rejected', message } };
}

function reply(c: Context, error: unknown) {
  const { status, body } = toError(error);
  return c.json(body, status);
}

export function createApiApp({ service, store, sessionSecret, secureCookies = false }: Options) {
  const app = new Hono<Env>();
  const sessions = createSessions(sessionSecret, secureCookies);

  // Hono hands only Error instances to onError and rethrows anything else, which drops the
  // connection: the catch answers those through the same mapping. csrf() refuses cross-origin
  // writes.
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    try {
      await next();
    } catch (error) {
      return reply(c, error);
    }
  }, csrf());

  app.get('/api/health', (c) => c.json({ ok: true, sdkConfigured: service !== null }));

  const signedIn = createMiddleware<Env>(async (c, next) => {
    const userId = await sessions.userId(c);
    const user = userId === null ? undefined : store.findUser(userId);
    if (!user) throw new PortalError('unauthenticated', 401, 'Sign in to continue.');
    c.set('user', user);
    await next();
  });

  // STUB: any well-formed email signs in. Replace this route and session.ts with your login.
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

  // Every device route needs a user and the API key. The service looks the device up from that
  // user's row; nothing in the request selects it.
  app.use('/api/device/*', signedIn, async (c, next) => {
    if (!service) throw new PortalError('missing_api_key', 503, NOT_SET_UP);
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
  app.onError((error, c) => reply(c, error));
  return app;
}
