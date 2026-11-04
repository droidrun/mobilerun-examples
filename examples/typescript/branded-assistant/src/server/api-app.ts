import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  sendMessageRequestSchema,
  sessionViewSchema,
  runViewSchema,
  startRunRequestSchema,
} from '@/shared/contracts';
import type { AssistantService } from './assistant-service';
import { ApiProblem, statusOf } from './errors';
import { stubSession, type SessionEnv } from './session';

type AppOptions = {
  service: AssistantService;
  sessionSecret: string;
  production: boolean;
};

const runIdSchema = z.uuid();

const NO_STORE = { 'Cache-Control': 'no-store' };

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status, headers: NO_STORE });
}

async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

export function createApiApp({
  service,
  sessionSecret,
  production,
}: AppOptions): Hono<SessionEnv> {
  const app = new Hono<SessionEnv>();

  app.get('/api/health', (context) =>
    context.json({ ok: true, sdkConfigured: service.sdkConfigured }, 200, NO_STORE),
  );

  // Rejects cross-origin form-style POSTs. The session cookie is also SameSite=Lax.
  app.use('/api/*', csrf());
  app.use('/api/*', stubSession(sessionSecret, production));

  const runId = (value: string): string => {
    const parsed = runIdSchema.safeParse(value);
    // Same answer as an unknown run, so ids reveal nothing.
    if (!parsed.success) throw new ApiProblem(404, 'run_not_found', 'Run not found.');
    return parsed.data;
  };

  app.get('/api/session', (context) =>
    context.json(
      sessionViewSchema.parse(service.session(context.get('userId'))),
      200,
      NO_STORE,
    ),
  );

  app.post('/api/runs', async (context) => {
    const parsed = startRunRequestSchema.safeParse(
      await readJson(context.req.raw),
    );
    if (!parsed.success) {
      throw new ApiProblem(
        400,
        'invalid_request',
        'Choose a request type and describe what you need.',
      );
    }
    const run = await service.start(context.get('userId'), parsed.data);
    // 202: the start could not be confirmed and is being reconciled.
    return context.json(
      runViewSchema.parse(run),
      run.status === 'unknown' ? 202 : 201,
      NO_STORE,
    );
  });

  app.get('/api/runs/:runId', (context) =>
    context.json(
      runViewSchema.parse(
        service.get(context.get('userId'), runId(context.req.param('runId'))),
      ),
      200,
      NO_STORE,
    ),
  );

  app.post('/api/runs/:runId/messages', async (context) => {
    const parsed = sendMessageRequestSchema.safeParse(
      await readJson(context.req.raw),
    );
    if (!parsed.success) {
      throw new ApiProblem(400, 'invalid_request', 'Write a short note.');
    }
    const run = await service.sendMessage(
      context.get('userId'),
      runId(context.req.param('runId')),
      parsed.data.message,
    );
    return context.json(runViewSchema.parse(run), 200, NO_STORE);
  });

  app.post('/api/runs/:runId/cancel', async (context) => {
    const run = await service.cancel(
      context.get('userId'),
      runId(context.req.param('runId')),
    );
    return context.json(runViewSchema.parse(run), 200, NO_STORE);
  });

  app.onError((error) => {
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof ApiProblem) {
      return errorResponse(error.status, error.code, error.message);
    }
    // API errors (4xx/422, such as an unavailable device) are rendered as
    // returned. Map them to your own copy for a white-label product.
    const status = statusOf(error);
    if (status !== undefined && status >= 400 && status < 600) {
      console.error('upstream request failed', status, error);
      return errorResponse(status, 'upstream_error', error.message);
    }
    console.error('unhandled API error', error);
    return errorResponse(500, 'internal_error', 'Unexpected server error.');
  });

  return app;
}
