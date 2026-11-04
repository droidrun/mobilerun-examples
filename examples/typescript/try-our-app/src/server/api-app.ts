import { Hono, type Context } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import { getConnInfo } from 'hono/bun';
import { createMiddleware } from 'hono/factory';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import {
  endSessionResponseSchema,
  healthSchema,
  sessionViewSchema,
  streamViewSchema,
} from '@/shared/contracts';
import type { RateLimiter } from './rate-limiter';
import { DemoError, type SessionService } from './session-service';

type AppOptions = {
  service: SessionService | null;
  limiter: RateLimiter;
  cookieSecret: string;
  secureCookies?: boolean;
};

type Env = { Variables: { service: SessionService; visitorId: string } };

const VISITOR_COOKIE = 'visitor';
const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const sessionIdSchema = z.uuid();

function upstreamStatus(error: unknown): number {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 600
  ) {
    return error.status;
  }
  return 502;
}

function remoteAddress(context: Context): string {
  try {
    return getConnInfo(context).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function createApiApp({
  service,
  limiter,
  cookieSecret,
  secureCookies = false,
}: AppOptions): Hono<Env> {
  const app = new Hono<Env>();

  const requireService = createMiddleware<Env>(async (context, next) => {
    if (!service) {
      throw new DemoError(
        'missing_api_key',
        500,
        'API key missing: set MOBILERUN_CLOUD_API_KEY on the server.',
      );
    }
    context.set('service', service);
    await next();
  });

  /** Reads the signed anonymous cookie; the start route mints one when absent. */
  const visitor = (mint: boolean) =>
    createMiddleware<Env>(async (context, next) => {
      let visitorId = await getSignedCookie(context, cookieSecret, VISITOR_COOKIE);
      if (!visitorId) {
        if (!mint) throw new DemoError('not_found', 404, 'Demo session not found.');
        visitorId = crypto.randomUUID();
        await setSignedCookie(context, VISITOR_COOKIE, visitorId, cookieSecret, {
          httpOnly: true,
          sameSite: 'Lax',
          secure: secureCookies,
          path: '/',
          maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
        });
      }
      context.set('visitorId', visitorId);
      await next();
    });

  /** Resuming a running demo costs nothing; only new starts count. */
  const rateLimit = createMiddleware<Env>(async (context, next) => {
    const visitorId = context.get('visitorId');
    if (context.get('service').current(visitorId)) return next();
    const result = limiter.consume([
      `ip:${remoteAddress(context)}`,
      `visitor:${visitorId}`,
    ]);
    if (!result.allowed) {
      throw new DemoError(
        'rate_limited',
        429,
        'You have started enough demos for now. Try again later.',
        { 'Retry-After': String(result.retryAfterSeconds) },
      );
    }
    await next();
  });

  const sessionId = createMiddleware<Env>(async (context, next) => {
    if (!sessionIdSchema.safeParse(context.req.param('id')).success) {
      throw new DemoError('invalid_session_id', 400, 'Session ID must be a UUID.');
    }
    await next();
  });

  // Hono hands only `Error` instances to onError and rethrows anything else,
  // which drops the connection. Wrap whatever else gets thrown so every
  // failure still reaches onError and the browser gets JSON.
  app.use('*', async (_context, next) => {
    try {
      await next();
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(`Non-Error thrown: ${String(error)}`, { cause: error });
    }
  });

  app.use('/api/*', async (context, next) => {
    await next();
    context.header('Cache-Control', 'no-store');
  });

  app.get('/api/health', (context) =>
    context.json(healthSchema.parse({ ok: true, sdkConfigured: service !== null })),
  );

  app.post(
    '/api/sessions',
    requireService,
    visitor(true),
    rateLimit,
    async (context) => {
      const demos = context.get('service');
      const visitorId = context.get('visitorId');
      const running = demos.current(visitorId);
      if (running) return context.json(sessionViewSchema.parse(running), 200);
      return context.json(
        sessionViewSchema.parse(await demos.start(visitorId)),
        201,
      );
    },
  );

  app.get(
    '/api/sessions/:id/stream',
    requireService,
    sessionId,
    visitor(false),
    async (context) =>
      context.json(
        streamViewSchema.parse(
          await context
            .get('service')
            .stream(context.req.param('id'), context.get('visitorId')),
        ),
      ),
  );

  app.delete(
    '/api/sessions/:id',
    requireService,
    sessionId,
    visitor(false),
    async (context) => {
      await context
        .get('service')
        .end(context.req.param('id'), context.get('visitorId'));
      return context.json(endSessionResponseSchema.parse({ ended: true }));
    },
  );

  // Every failure leaves through here, so the browser always gets JSON. The
  // API's own status is passed through (this server adds no gates of its own);
  // its text is logged, not shown to visitors.
  app.onError((error, context) => {
    if (error instanceof DemoError) {
      return context.json(
        { error: error.code, message: error.message },
        error.status as ContentfulStatusCode,
        { 'Cache-Control': 'no-store', ...error.headers },
      );
    }
    console.error('request failed', error);
    return context.json(
      {
        error: 'demo_unavailable',
        message: 'Something went wrong. Please try again.',
      },
      upstreamStatus(error) as ContentfulStatusCode,
      { 'Cache-Control': 'no-store' },
    );
  });

  return app;
}
