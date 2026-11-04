import { Hono } from 'hono';
import { getConnInfo } from 'hono/bun';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { RateLimiter } from './rate-limiter';
import { DemoError, type SessionService } from './session-service';

type Env = { Variables: { visitorId: string } };
type Options = {
  service: SessionService | null;
  limiter: RateLimiter;
  cookieSecret: string;
  secureCookies?: boolean;
};

const COOKIE = 'visitor';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // seconds

/** The API's own status for its errors (for example 402 or 422), 502 for anything else. */
function upstreamStatus(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  const ok = typeof status === 'number' && status >= 400 && status < 600;
  return (ok ? status : 502) as ContentfulStatusCode;
}

export function createApiApp({ service, limiter, cookieSecret, secureCookies = false }: Options) {
  const app = new Hono<Env>();

  const demos = () => {
    if (service) return service;
    throw new DemoError('missing_api_key', 500, 'Set MOBILERUN_CLOUD_API_KEY on the server.');
  };

  /** The signed, anonymous visitor cookie that owns a session. Only a start mints one. */
  const visitor = (mint: boolean) =>
    createMiddleware<Env>(async (context, next) => {
      let visitorId = await getSignedCookie(context, cookieSecret, COOKIE);
      if (!visitorId) {
        if (!mint) throw new DemoError('not_found', 404, 'Demo session not found.');
        visitorId = crypto.randomUUID();
        await setSignedCookie(context, COOKIE, visitorId, cookieSecret, {
          httpOnly: true,
          sameSite: 'Lax',
          secure: secureCookies,
          path: '/',
          maxAge: COOKIE_MAX_AGE,
        });
      }
      context.set('visitorId', visitorId);
      await next();
    });

  // Hono hands only Error instances to onError and rethrows anything else,
  // which drops the connection. Wrap the rest so the browser always gets JSON.
  app.use('/api/*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    try {
      await next();
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error(`Non-Error thrown: ${String(error)}`, { cause: error });
    }
  });

  app.get('/api/health', (context) => context.json({ ok: true, sdkConfigured: service !== null }));

  app.post('/api/sessions', visitor(true), async (context) => {
    const service = demos();
    const visitorId = context.get('visitorId');
    // Picking up a running demo is free; only new starts count against the limit.
    const running = service.current(visitorId);
    if (running) return context.json(running, 200);
    const ip = getConnInfo(context).remote.address ?? 'unknown';
    const limit = limiter.consume([`ip:${ip}`, `visitor:${visitorId}`]);
    if (!limit.allowed) {
      context.header('Retry-After', String(limit.retryAfterSeconds));
      const message = 'You have started enough demos for now. Try again later.';
      throw new DemoError('rate_limited', 429, message);
    }
    return context.json(await service.start(visitorId), 201);
  });

  app.get('/api/sessions/:id/stream', visitor(false), async (context) =>
    context.json(await demos().stream(context.req.param('id'), context.get('visitorId'))),
  );

  app.delete('/api/sessions/:id', visitor(false), async (context) => {
    await demos().end(context.req.param('id'), context.get('visitorId'));
    return context.json({ ended: true });
  });

  // Every failure leaves as JSON. API errors keep their HTTP status; their text
  // is logged for you and never shown to visitors.
  app.onError((error, context) => {
    if (error instanceof DemoError) {
      const status = error.status as ContentfulStatusCode;
      return context.json({ error: error.code, message: error.message }, status);
    }
    console.error('request failed', error);
    const message = 'Something went wrong. Please try again.';
    return context.json({ error: 'demo_unavailable', message }, upstreamStatus(error));
  });

  return app;
}
