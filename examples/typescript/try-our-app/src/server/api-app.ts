import { Hono, type Context } from 'hono';
import { getConnInfo } from 'hono/bun';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ErrorBody } from '@/shared/contracts';
import type { RateLimiter } from './rate-limiter';
import { DemoError, type SessionService } from './session-service';

type Env = { Variables: { visitorId: string; service: SessionService } };
type Options = {
  service: SessionService | null; // null while MOBILERUN_CLOUD_API_KEY is not set
  limiter: RateLimiter;
  sessionSecret: string;
  secureCookies?: boolean;
};
type UpstreamError = { status?: unknown; error?: Record<string, unknown> | null };

const COOKIE = 'visitor';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // seconds
const SOMETHING_WRONG = 'Something went wrong. Please try again.';
const NOT_SET_UP = 'This service is not set up yet. Please try again later.';

/**
 * The one error mapping. Own refusals keep their status and text. An API 4xx (an unavailable
 * device type, an insufficient balance) keeps its status and the API's text. A 401/403 means
 * this server's key is wrong, not the user's session: like a 5xx it becomes a plain 502.
 * Anything else, a thrown non-Error included, is a plain 500.
 */
function toError(error: unknown): { status: ContentfulStatusCode; body: ErrorBody } {
  if (error instanceof DemoError) {
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

export function createApiApp({ service, limiter, sessionSecret, secureCookies = false }: Options) {
  const app = new Hono<Env>();
  const cookieOptions = {
    httpOnly: true, sameSite: 'Lax', secure: secureCookies, path: '/', maxAge: COOKIE_MAX_AGE,
  } as const;

  // Hono hands only Error instances to onError and rethrows anything else, which drops the
  // connection: the catch answers those through the same mapping.
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    try {
      await next();
    } catch (error) {
      return reply(c, error);
    }
  });

  app.get('/api/health', (c) => c.json({ ok: true, sdkConfigured: service !== null }));

  // Every session route needs the API key.
  app.use('/api/sessions/*', async (c, next) => {
    if (!service) throw new DemoError('missing_api_key', 503, NOT_SET_UP);
    c.set('service', service);
    await next();
  });

  /** The signed, anonymous visitor cookie that owns a session. Only a start mints one. */
  const visitor = (mint: boolean) =>
    createMiddleware<Env>(async (c, next) => {
      let visitorId = await getSignedCookie(c, sessionSecret, COOKIE);
      if (!visitorId) {
        if (!mint) throw new DemoError('not_found', 404, 'Demo session not found.');
        visitorId = crypto.randomUUID();
        await setSignedCookie(c, COOKIE, visitorId, sessionSecret, cookieOptions);
      }
      c.set('visitorId', visitorId);
      await next();
    });

  app.post('/api/sessions', visitor(true), async (c) => {
    const { service, visitorId } = c.var;
    // Picking up a running demo is free; only new starts count against the limit.
    const running = service.current(visitorId);
    if (running) return c.json(running, 200);
    const ip = getConnInfo(c).remote.address ?? 'unknown';
    const limit = limiter.consume([`ip:${ip}`, `visitor:${visitorId}`]);
    if (!limit.allowed) {
      c.header('Retry-After', String(limit.retryAfterSeconds));
      const message = 'You have started enough demos for now. Try again later.';
      throw new DemoError('rate_limited', 429, message);
    }
    return c.json(await service.start(visitorId), 201);
  });

  app.get('/api/sessions/:id/stream', visitor(false), async (c) =>
    c.json(await c.var.service.stream(c.req.param('id'), c.var.visitorId)),
  );

  app.delete('/api/sessions/:id', visitor(false), async (c) => {
    await c.var.service.end(c.req.param('id'), c.var.visitorId);
    return c.json({ ended: true });
  });

  app.notFound((c) => c.json({ error: 'not_found', message: 'Not found.' }, 404));
  app.onError((error, c) => reply(c, error));
  return app;
}
