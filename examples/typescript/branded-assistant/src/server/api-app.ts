import { Hono } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { AssistantError, type AssistantService } from './assistant-service';

type Options = { service: AssistantService; sessionSecret: string; secureCookies?: boolean };

const COOKIE = 'assistant_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // seconds
// Strict: privileged task options (prompt, model, schema) are never taken from the browser.
const startBody = z.strictObject({
  presetId: z.string().max(64),
  message: z.string().trim().min(1).max(2_000),
});
const noteBody = z.strictObject({ message: z.string().trim().min(1).max(1_000) });
const json = (request: Request) => request.json().catch(() => null);

export function createApiApp({ service, sessionSecret, secureCookies = false }: Options) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get('/api/health', (c) => c.json({ ok: true, sdkConfigured: service.configured }));

  // Rejects cross-origin form posts; the session cookie is SameSite=Lax as well.
  app.use('/api/*', csrf());

  // STUB IDENTITY: a random user id in a signed, HttpOnly cookie keeps one browser's runs and
  // credits apart from another's, and nothing more. Replace it with your own authentication;
  // the routes only read `userId`.
  app.use('/api/*', async (c, next) => {
    let userId = await getSignedCookie(c, sessionSecret, COOKIE);
    if (!userId) {
      userId = crypto.randomUUID();
      await setSignedCookie(c, COOKIE, userId, sessionSecret, {
        httpOnly: true, sameSite: 'Lax', secure: secureCookies, path: '/', maxAge: COOKIE_MAX_AGE,
      });
    }
    c.set('userId', userId);
    await next();
  });

  app.get('/api/session', (c) => c.json(service.session(c.get('userId'))));

  app.post('/api/runs', async (c) => {
    const { presetId, message } = startBody.parse(await json(c.req.raw));
    const run = await service.start(c.get('userId'), presetId, message);
    // 202: the start could not be confirmed and is being checked.
    return c.json(run, run.status === 'unknown' ? 202 : 201);
  });

  app.get('/api/runs/:id', (c) => c.json(service.get(c.get('userId'), c.req.param('id'))));

  app.post('/api/runs/:id/messages', async (c) => {
    const { message } = noteBody.parse(await json(c.req.raw));
    return c.json(await service.sendNote(c.get('userId'), c.req.param('id'), message));
  });

  app.post('/api/runs/:id/cancel', async (c) =>
    c.json(await service.cancel(c.get('userId'), c.req.param('id'))),
  );

  // The one error mapping.
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    const reply = (status: number, code: string, message: string) =>
      c.json({ error: code, message }, status as ContentfulStatusCode);
    if (error instanceof AssistantError) return reply(error.status, error.code, error.message);
    if (error instanceof z.ZodError) return reply(400, 'invalid_request', 'Check your request.');
    // API errors keep their status and text (for example 422 for an unavailable device). Map
    // them to your own copy for a white-label product.
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 600) {
      console.error('upstream request failed', status, error);
      return reply(status, 'upstream_error', error.message);
    }
    console.error('request failed', error);
    return reply(500, 'internal_error', 'Something went wrong. Please try again.');
  });

  return app;
}
