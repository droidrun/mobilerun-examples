import { Hono, type Context } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { ErrorBody } from '@/shared/contracts';
import { AssistantError, type AssistantService } from './assistant-service';

type Env = { Variables: { userId: string } };
type Options = { service: AssistantService; sessionSecret: string; secureCookies?: boolean };
type UpstreamError = { status?: unknown; error?: Record<string, unknown> | null };

const COOKIE = 'assistant_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // seconds
const SOMETHING_WRONG = 'Something went wrong. Please try again.';
const NOT_SET_UP = 'This service is not set up yet. Please try again later.';
// Strict: privileged task options (prompt, model, schema) are never taken from the browser.
const startBody = z.strictObject({
  presetId: z.string().max(64),
  message: z.string().trim().min(1).max(2_000),
});
const noteBody = z.strictObject({ message: z.string().trim().min(1).max(1_000) });

/** The request's JSON body, checked against `schema`; anything else is a 400. */
async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new AssistantError('invalid_request', 400, 'Check your request.');
  return parsed.data;
}

/**
 * The one error mapping. Own refusals keep their status and text. An API 4xx (an unavailable
 * device type, an insufficient balance) keeps its status and the API's text. A 401/403 means
 * this server's key is wrong, not the user's session: like a 5xx it becomes a plain 502.
 * Anything else, a thrown non-Error included, is a plain 500.
 */
function toError(error: unknown): { status: ContentfulStatusCode; body: ErrorBody } {
  if (error instanceof AssistantError) {
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
  const text = [body?.message, body?.detail, body?.title].find((v) => typeof v === 'string' && v);
  const message = typeof text === 'string' ? text : SOMETHING_WRONG;
  return { status: status as ContentfulStatusCode, body: { error: 'upstream_rejected', message } };
}

function reply(c: Context, error: unknown) {
  const { status, body } = toError(error);
  return c.json(body, status);
}

export function createApiApp({ service, sessionSecret, secureCookies = false }: Options) {
  const app = new Hono<Env>();
  const cookieOptions = {
    httpOnly: true, sameSite: 'Lax', secure: secureCookies, path: '/', maxAge: COOKIE_MAX_AGE,
  } as const;

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

  app.get('/api/health', (c) => c.json({ ok: true, sdkConfigured: service.configured }));

  // STUB: a random user id in a signed cookie stands in for your login; routes read `userId`.
  app.use('/api/*', async (c, next) => {
    let userId = await getSignedCookie(c, sessionSecret, COOKIE);
    if (!userId) {
      userId = crypto.randomUUID();
      await setSignedCookie(c, COOKIE, userId, sessionSecret, cookieOptions);
    }
    c.set('userId', userId);
    await next();
  });

  app.get('/api/session', (c) => c.json(service.session(c.var.userId)));

  // Every run route needs the API key.
  app.use('/api/runs/*', async (c, next) => {
    if (!service.configured) throw new AssistantError('missing_api_key', 503, NOT_SET_UP);
    await next();
  });

  app.post('/api/runs', async (c) => {
    const { presetId, message } = await readBody(c.req.raw, startBody);
    const run = await service.start(c.var.userId, presetId, message);
    // 202: the start could not be confirmed and is being checked.
    return c.json(run, run.status === 'unknown' ? 202 : 201);
  });

  app.get('/api/runs/:id', (c) => c.json(service.get(c.var.userId, c.req.param('id'))));

  app.post('/api/runs/:id/messages', async (c) => {
    const { message } = await readBody(c.req.raw, noteBody);
    return c.json(await service.sendNote(c.var.userId, c.req.param('id'), message));
  });

  app.post('/api/runs/:id/cancel', async (c) =>
    c.json(await service.cancel(c.var.userId, c.req.param('id'))),
  );

  app.notFound((c) => c.json({ error: 'not_found', message: 'Not found.' }, 404));
  app.onError((error, c) => reply(c, error));
  return app;
}
