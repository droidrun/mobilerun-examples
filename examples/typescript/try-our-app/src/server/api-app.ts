import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import { getConnInfo } from 'hono/bun';
import { z } from 'zod';
import {
  endSessionResponseSchema,
  healthSchema,
  sessionViewSchema,
  streamViewSchema,
  type Brand,
} from '@/shared/contracts';
import type { RateLimiter } from './rate-limiter';
import { DemoError, type SessionService } from './session-service';

type AppOptions = {
  service: SessionService | null;
  brand: Brand;
  limiter: RateLimiter;
  cookieSecret: string;
  secureCookies?: boolean;
};

const VISITOR_COOKIE = 'visitor';
const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const sessionIdSchema = z.uuid();

// Responses go through the Hono context so the visitor cookie set earlier in a
// handler is kept on every reply, errors included.
function jsonResponse(
  context: Context,
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return context.json(body, status as ContentfulStatusCode, {
    'Cache-Control': 'no-store',
    ...headers,
  });
}

function errorResponse(
  context: Context,
  error: string,
  message: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(context, { error, message }, status, headers);
}

function missingApiKeyResponse(context: Context): Response {
  return errorResponse(
    context,
    'missing_api_key',
    'API key missing: set MOBILERUN_CLOUD_API_KEY on the server.',
    500,
  );
}

function bodyMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  for (const key of ['detail', 'message', 'title']) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** Passes the API's own status and message through. Clients add no gates of their own. */
function failure(context: Context, action: string, error: unknown): Response {
  if (error instanceof DemoError) {
    return errorResponse(context, error.code, error.message, error.status);
  }
  console.error(`${action} failed`, error);
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 600
      ? error.status
      : 502;
  const upstream =
    typeof error === 'object' && error !== null && 'error' in error
      ? bodyMessage(error.error)
      : undefined;
  return errorResponse(
    context,
    'demo_unavailable',
    upstream ?? 'The demo could not be started.',
    status,
  );
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
  brand,
  limiter,
  cookieSecret,
  secureCookies = false,
}: AppOptions): Hono {
  const app = new Hono();

  const readVisitor = async (context: Context): Promise<string | undefined> => {
    const value = await getSignedCookie(context, cookieSecret, VISITOR_COOKIE);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  const ensureVisitor = async (context: Context): Promise<string> => {
    const existing = await readVisitor(context);
    if (existing) return existing;
    const visitorId = crypto.randomUUID();
    await setSignedCookie(context, VISITOR_COOKIE, visitorId, cookieSecret, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: secureCookies,
      path: '/',
      maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
    });
    return visitorId;
  };

  const parseSessionId = (context: Context, value: string): string | Response => {
    const parsed = sessionIdSchema.safeParse(value);
    return parsed.success
      ? parsed.data
      : errorResponse(
          context,
          'invalid_session_id',
          'Session ID must be a UUID.',
          400,
        );
  };

  app.get('/api/health', (context) =>
    context.json(
      healthSchema.parse({ ok: true, sdkConfigured: service !== null }),
      200,
      { 'Cache-Control': 'no-store' },
    ),
  );

  app.get('/api/brand', (context) =>
    context.json(brand, 200, { 'Cache-Control': 'no-store' }),
  );

  app.post('/api/sessions', async (context) => {
    if (!service) return missingApiKeyResponse(context);
    const visitorId = await ensureVisitor(context);

    try {
      const running = service.current(visitorId);
      if (running) return jsonResponse(context, sessionViewSchema.parse(running), 200);

      const limit = limiter.consume([
        `ip:${remoteAddress(context)}`,
        `visitor:${visitorId}`,
      ]);
      if (!limit.allowed) {
        return errorResponse(
          context,
          'rate_limited',
          'You have started enough demos for now. Try again later.',
          429,
          { 'Retry-After': String(limit.retryAfterSeconds) },
        );
      }

      return jsonResponse(
        context,
        sessionViewSchema.parse(await service.start(visitorId)),
        201,
      );
    } catch (error) {
      return failure(context, 'start demo', error);
    }
  });

  app.get('/api/sessions/:id/stream', async (context) => {
    if (!service) return missingApiKeyResponse(context);
    const sessionId = parseSessionId(context, context.req.param('id'));
    if (sessionId instanceof Response) return sessionId;
    const visitorId = await readVisitor(context);
    if (!visitorId) {
      return errorResponse(context, 'not_found', 'Demo session not found.', 404);
    }

    try {
      return jsonResponse(
        context,
        streamViewSchema.parse(await service.stream(sessionId, visitorId)),
        200,
      );
    } catch (error) {
      return failure(context, 'retrieve stream', error);
    }
  });

  app.delete('/api/sessions/:id', async (context) => {
    if (!service) return missingApiKeyResponse(context);
    const sessionId = parseSessionId(context, context.req.param('id'));
    if (sessionId instanceof Response) return sessionId;
    const visitorId = await readVisitor(context);
    if (!visitorId) {
      return errorResponse(context, 'not_found', 'Demo session not found.', 404);
    }

    try {
      await service.end(sessionId, visitorId);
      return jsonResponse(
        context,
        endSessionResponseSchema.parse({ ended: true }),
        200,
      );
    } catch (error) {
      return failure(context, 'end demo', error);
    }
  });

  app.onError((error, context) => {
    console.error('unhandled API error', error);
    return errorResponse(
      context,
      'internal_error',
      'Unexpected server error.',
      500,
    );
  });

  return app;
}
