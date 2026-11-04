import { Hono, type Context } from 'hono';
import {
  adminOverviewSchema,
  deviceViewSchema,
  loginRequestSchema,
  sessionSchema,
  streamCredentialsSchema,
} from '@/shared/contracts';
import { PortalError, type PortalService } from './portal-service';
import { endSession, readSessionUserId, startSession } from './session';
import type { PortalStore, UserRow } from './store';

type AppOptions = {
  /** Null while MOBILERUN_API_KEY is not configured. */
  service: PortalService | null;
  store: PortalStore;
  sessionSecret: string;
  production: boolean;
  adminEmails: ReadonlyArray<string>;
};

type Env = { Variables: { user: UserRow } };

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function errorResponse(
  status: number,
  error: string,
  message: string,
): Response {
  return jsonResponse({ error, message }, status);
}

function readUpstreamStatus(error: unknown): number | undefined {
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
  return undefined;
}

// Mobilerun puts the human-readable reason in one of these body fields.
function readUpstreamMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('error' in error)) {
    return undefined;
  }
  const body = error.error;
  if (typeof body !== 'object' || body === null) return undefined;
  for (const field of ['message', 'detail', 'title']) {
    const value = (body as Record<string, unknown>)[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Pass Mobilerun's own 4xx answer (device type unavailable, insufficient
 * balance, ...) through to the end user. A 401/403 means the portal's own API
 * key is wrong, which is not the end user's session problem.
 */
function upstreamErrorResponse(error: unknown, fallback: string): Response {
  const status = readUpstreamStatus(error);
  if (status === undefined || status === 401 || status === 403 || status >= 500) {
    return errorResponse(502, 'upstream_error', fallback);
  }
  return errorResponse(
    status,
    'upstream_rejected',
    readUpstreamMessage(error) ?? fallback,
  );
}

export function createApiApp({
  service,
  store,
  sessionSecret,
  production,
  adminEmails,
}: AppOptions): Hono<Env> {
  const app = new Hono<Env>();
  const isAdmin = (email: string) => adminEmails.includes(email);

  const requireUser = async (context: Context<Env>, next: () => Promise<void>) => {
    const userId = await readSessionUserId(context, sessionSecret);
    const user = userId === null ? undefined : store.findUser(userId);
    if (!user) {
      return errorResponse(401, 'unauthenticated', 'Sign in to continue.');
    }
    context.set('user', user);
    await next();
  };

  const requireService = async (_: Context<Env>, next: () => Promise<void>) => {
    if (!service) {
      return errorResponse(
        500,
        'missing_api_key',
        'Set MOBILERUN_API_KEY on the server.',
      );
    }
    await next();
  };

  app.get('/api/health', (context) =>
    context.json({ ok: true, sdkConfigured: service !== null }, 200, {
      'Cache-Control': 'no-store',
    }),
  );

  app.post('/api/login', async (context) => {
    const parsed = loginRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return errorResponse(400, 'invalid_request', 'Enter a valid email.');
    }
    // Stub login: any well-formed email signs in. Replace with your IdP.
    const user = store.upsertUser(parsed.data.email);
    await startSession(context, user.id, {
      secret: sessionSecret,
      secure: production,
    });
    // Answer through the context so the Set-Cookie header is kept.
    return context.json(
      sessionSchema.parse({ email: user.email, isAdmin: isAdmin(user.email) }),
      200,
      { 'Cache-Control': 'no-store' },
    );
  });

  app.post('/api/logout', (context) => {
    endSession(context, production);
    return context.json({ ok: true }, 200, { 'Cache-Control': 'no-store' });
  });

  app.get('/api/me', requireUser, (context) => {
    const user = context.get('user');
    return jsonResponse(
      sessionSchema.parse({ email: user.email, isAdmin: isAdmin(user.email) }),
      200,
    );
  });

  // Every /api/device route: signed-in user, configured SDK, and a device id
  // that is looked up from that user's own row (never from the request).
  app.use('/api/device', requireUser, requireService);
  app.use('/api/device/*', requireUser, requireService);

  const handle =
    (
      fallback: string,
      run: (userId: number, svc: PortalService) => Promise<Response>,
    ) =>
    async (context: Context<Env>) => {
      try {
        return await run(context.get('user').id, service as PortalService);
      } catch (error) {
        if (error instanceof PortalError) {
          return errorResponse(error.status, error.code, error.message);
        }
        console.error(fallback, error);
        return upstreamErrorResponse(error, fallback);
      }
    };

  app.post(
    '/api/device',
    handle('Mobilerun could not create the device.', async (userId, svc) =>
      jsonResponse(deviceViewSchema.parse(await svc.create(userId)), 201),
    ),
  );

  app.get(
    '/api/device',
    handle('Mobilerun could not load the device.', async (userId, svc) =>
      jsonResponse(deviceViewSchema.parse(await svc.get(userId)), 200),
    ),
  );

  app.delete(
    '/api/device',
    handle('Mobilerun could not terminate the device.', async (userId, svc) => {
      await svc.terminate(userId);
      return new Response(null, {
        status: 204,
        headers: { 'Cache-Control': 'no-store' },
      });
    }),
  );

  const actions = [
    ['stop', (svc: PortalService, id: number) => svc.stop(id)],
    ['resume', (svc: PortalService, id: number) => svc.resume(id)],
    ['reboot', (svc: PortalService, id: number) => svc.reboot(id)],
    ['reset', (svc: PortalService, id: number) => svc.reset(id)],
  ] as const;

  for (const [name, action] of actions) {
    app.post(
      `/api/device/${name}`,
      handle(`Mobilerun could not ${name} the device.`, async (userId, svc) => {
        await action(svc, userId);
        return jsonResponse({ ok: true }, 202);
      }),
    );
  }

  app.get(
    '/api/device/stream',
    handle('Mobilerun could not open the stream.', async (userId, svc) =>
      jsonResponse(streamCredentialsSchema.parse(await svc.stream(userId)), 200),
    ),
  );

  app.get('/api/admin/users', requireUser, requireService, async (context) => {
    if (!isAdmin(context.get('user').email)) {
      return errorResponse(403, 'forbidden', 'Admins only.');
    }
    try {
      return jsonResponse(
        adminOverviewSchema.parse(await (service as PortalService).adminOverview()),
        200,
      );
    } catch (error) {
      console.error('admin overview failed', error);
      return errorResponse(502, 'upstream_error', 'Could not load the overview.');
    }
  });

  app.notFound((context) =>
    context.req.path.startsWith('/api/')
      ? errorResponse(404, 'not_found', 'Not found.')
      : context.text('Not found', 404),
  );

  app.onError((error) => {
    console.error('unhandled API error', error);
    return errorResponse(500, 'internal_error', 'Unexpected server error.');
  });

  return app;
}
