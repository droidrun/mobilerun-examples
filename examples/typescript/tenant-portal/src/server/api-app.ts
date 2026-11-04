import { Hono, type Context, type Next } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  deviceActionSchema,
  deviceViewSchema,
  loginRequestSchema,
  sessionSchema,
  streamCredentialsSchema,
} from '@/shared/contracts';
import { PortalError, type PortalService } from './portal-service';
import { endSession, readSessionUserId, startSession } from './session';
import type { PortalStore, UserRow } from './store';

type AppOptions = {
  /** Null while MOBILERUN_CLOUD_API_KEY is not configured. */
  service: PortalService | null;
  store: PortalStore;
  sessionSecret: string;
  production: boolean;
};

type Env = { Variables: { user: UserRow; service: PortalService } };
type AppContext = Context<Env>;

function fail(
  context: AppContext,
  status: number,
  error: string,
  message: string,
): Response {
  return context.json({ error, message }, status as ContentfulStatusCode);
}

// Mobilerun puts the human-readable reason in one of these body fields.
function readUpstreamMessage(error: unknown): string | undefined {
  const body =
    typeof error === 'object' && error !== null && 'error' in error
      ? error.error
      : undefined;
  if (typeof body !== 'object' || body === null) return undefined;
  for (const field of ['message', 'detail', 'title']) {
    const value = (body as Record<string, unknown>)[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Pass Mobilerun's own 4xx answer (device type unavailable, insufficient
 * balance, ...) through as returned. A 401/403 means the portal's own API key
 * is wrong, which is not the end user's session problem, so it becomes a 502.
 */
function upstreamError(
  error: unknown,
  fallback: string,
): { status: number; code: string; message: string } {
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : undefined;
  if (status === undefined || status < 400 || status >= 500 || status === 401 || status === 403) {
    return { status: 502, code: 'upstream_error', message: fallback };
  }
  return {
    status,
    code: 'upstream_rejected',
    message: readUpstreamMessage(error) ?? fallback,
  };
}

export function createApiApp({
  service,
  store,
  sessionSecret,
  production,
}: AppOptions): Hono<Env> {
  const app = new Hono<Env>();

  app.use('/api/*', csrf());
  app.use('/api/*', async (context, next) => {
    await next();
    context.header('Cache-Control', 'no-store');
  });

  const requireUser = async (context: AppContext, next: Next) => {
    const userId = await readSessionUserId(context, sessionSecret);
    const user = userId === null ? undefined : store.findUser(userId);
    if (!user) {
      return fail(context, 401, 'unauthenticated', 'Sign in to continue.');
    }
    context.set('user', user);
    await next();
  };

  const requireService = async (context: AppContext, next: Next) => {
    if (!service) {
      return fail(
        context,
        500,
        'missing_api_key',
        'Set MOBILERUN_CLOUD_API_KEY on the server.',
      );
    }
    context.set('service', service);
    await next();
  };

  app.get('/api/health', (context) =>
    context.json({ ok: true, sdkConfigured: service !== null }),
  );

  app.post('/api/login', async (context) => {
    const parsed = loginRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return fail(context, 400, 'invalid_request', 'Enter a valid email.');
    }
    // STUB: any well-formed email signs in as that user. Delete this route and
    // session.ts together when you wire your identity provider.
    const user = store.upsertUser(parsed.data.email);
    await startSession(context, user.id, {
      secret: sessionSecret,
      secure: production,
    });
    return context.json(sessionSchema.parse({ email: user.email }));
  });

  app.post('/api/logout', (context) => {
    endSession(context, production);
    return context.json({ ok: true });
  });

  app.get('/api/me', requireUser, (context) =>
    context.json(sessionSchema.parse({ email: context.get('user').email })),
  );

  // Every /api/device route: signed-in user, configured SDK, and a device id
  // that is looked up from that user's own row (never from the request).
  app.use('/api/device/*', requireUser, requireService);

  const handle =
    (
      fallback: string,
      run: (
        context: AppContext,
        userId: number,
        svc: PortalService,
      ) => Promise<Response>,
    ) =>
    async (context: AppContext) => {
      try {
        return await run(
          context,
          context.get('user').id,
          context.get('service'),
        );
      } catch (error) {
        if (error instanceof PortalError) {
          return fail(context, error.status, error.code, error.message);
        }
        console.error(fallback, error);
        const upstream = upstreamError(error, fallback);
        return fail(context, upstream.status, upstream.code, upstream.message);
      }
    };

  app.post(
    '/api/device',
    handle('Mobilerun could not create the device.', async (c, userId, svc) =>
      c.json(deviceViewSchema.parse(await svc.create(userId)), 201),
    ),
  );

  app.get(
    '/api/device',
    handle('Mobilerun could not load the device.', async (c, userId, svc) =>
      c.json(deviceViewSchema.parse(await svc.get(userId))),
    ),
  );

  app.delete(
    '/api/device',
    handle(
      'Mobilerun could not terminate the device.',
      async (c, userId, svc) => {
        await svc.terminate(userId);
        return c.body(null, 204);
      },
    ),
  );

  app.get(
    '/api/device/stream',
    handle('Mobilerun could not open the stream.', async (c, userId, svc) =>
      c.json(streamCredentialsSchema.parse(await svc.stream(userId))),
    ),
  );

  app.post(
    '/api/device/:action',
    handle('Mobilerun could not update the device.', async (c, userId, svc) => {
      const action = deviceActionSchema.safeParse(c.req.param('action'));
      if (!action.success) return fail(c, 404, 'not_found', 'Not found.');
      await svc.act(userId, action.data);
      return c.json({ ok: true }, 202);
    }),
  );

  app.notFound((context) =>
    context.req.path.startsWith('/api/')
      ? fail(context, 404, 'not_found', 'Not found.')
      : context.text('Not found', 404),
  );

  app.onError((error, context) => {
    if (error instanceof HTTPException) {
      return fail(context, error.status, 'request_rejected', 'Request rejected.');
    }
    console.error('unhandled API error', error);
    return fail(context, 500, 'internal_error', 'Unexpected server error.');
  });

  return app;
}
