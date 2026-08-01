import { Hono } from 'hono';
import { z } from 'zod';
import {
  cancelTaskResponseSchema,
  deviceListResponseSchema,
  runTaskRequestSchema,
  runTaskResponseSchema,
  taskViewSchema,
} from '@/shared/contracts';
import type { TaskService } from './task-service';

type AppOptions = {
  service: TaskService | null;
};

const taskIdSchema = z.uuid();

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function missingApiKeyResponse(): Response {
  return jsonResponse(
    {
      error: 'missing_api_key',
      message: 'Set MOBILERUN_CLOUD_API_KEY on the server.',
    },
    500,
  );
}

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

function parseTaskId(value: string): string | Response {
  const parsed = taskIdSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : jsonResponse(
        { error: 'invalid_task_id', message: 'Task ID must be a UUID.' },
        400,
      );
}

export function createApiApp({ service }: AppOptions): Hono {
  const app = new Hono();

  app.get('/api/health', (context) =>
    context.json(
      { ok: true, sdkConfigured: service !== null },
      200,
      { 'Cache-Control': 'no-store' },
    ),
  );

  app.get('/api/devices', async () => {
    if (!service) return missingApiKeyResponse();
    try {
      return jsonResponse(
        deviceListResponseSchema.parse({
          items: await service.listDevices(),
        }),
        200,
      );
    } catch (error) {
      console.error('devices.list failed', error);
      return jsonResponse(
        {
          error: 'device_list_failed',
          message: 'Mobilerun could not list available devices.',
        },
        upstreamStatus(error),
      );
    }
  });

  app.post('/api/runs', async (context) => {
    if (!service) return missingApiKeyResponse();
    const parsed = runTaskRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return jsonResponse(
        {
          error: 'invalid_request',
          message: 'Provide a task and valid runner options.',
        },
        400,
      );
    }

    try {
      return jsonResponse(
        runTaskResponseSchema.parse(await service.start(parsed.data)),
        201,
      );
    } catch (error) {
      console.error('tasks.run failed', error);
      return jsonResponse(
        {
          error: 'task_start_failed',
          message: 'Mobilerun could not start the task.',
        },
        upstreamStatus(error),
      );
    }
  });

  app.get('/api/runs/:taskId', async (context) => {
    if (!service) return missingApiKeyResponse();
    const taskId = parseTaskId(context.req.param('taskId'));
    if (taskId instanceof Response) return taskId;

    try {
      return jsonResponse(
        taskViewSchema.parse(await service.retrieve(taskId)),
        200,
      );
    } catch (error) {
      console.error('tasks.retrieve failed', error);
      return jsonResponse(
        {
          error: 'task_retrieve_failed',
          message: 'Mobilerun could not retrieve the task.',
        },
        upstreamStatus(error),
      );
    }
  });

  app.post('/api/runs/:taskId/cancel', async (context) => {
    if (!service) return missingApiKeyResponse();
    const taskId = parseTaskId(context.req.param('taskId'));
    if (taskId instanceof Response) return taskId;

    try {
      return jsonResponse(
        cancelTaskResponseSchema.parse(await service.cancel(taskId)),
        200,
      );
    } catch (error) {
      console.error('tasks.stop failed', error);
      const status = upstreamStatus(error);
      return jsonResponse(
        {
          error: status === 409 ? 'task_already_terminal' : 'task_cancel_failed',
          message:
            status === 409
              ? 'The task already reached a terminal state.'
              : 'Mobilerun could not cancel the task.',
        },
        status,
      );
    }
  });

  app.onError((error) => {
    console.error('unhandled API error', error);
    return jsonResponse(
      { error: 'internal_error', message: 'Unexpected server error.' },
      500,
    );
  });

  return app;
}
