import Mobilerun from '@mobilerun/sdk';
import { upstreamStatusSchema } from './progress';
import { UpstreamError } from './errors';
import type { AssistantDeps } from './assistant-service';

/** Prefer the API's own error text over the SDK's "422 {json}" message. */
function describeApiError(error: InstanceType<typeof Mobilerun.APIError>): string {
  const body = error.error;
  if (typeof body === 'object' && body !== null) {
    for (const key of ['detail', 'message', 'title']) {
      const value = (body as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return error.message;
}

async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Mobilerun.APIError) {
      throw new UpstreamError(error.status, describeApiError(error));
    }
    throw error;
  }
}

/** The only module that touches @mobilerun/sdk. */
export function createMobilerunAssistantDeps(
  client: Mobilerun,
): AssistantDeps {
  return {
    async startTask(input) {
      const response = await call(() => client.tasks.run(input));
      return { taskId: response.id };
    },

    async getStatus(taskId) {
      const response = await call(() => client.tasks.getStatus(taskId));
      return {
        status: upstreamStatusSchema.parse(response.status),
        succeeded: response.succeeded,
        steps: response.steps,
        message: response.message,
        lastResponse: response.lastResponse,
      };
    },

    async retrieveTask(taskId) {
      const { task } = await call(() => client.tasks.retrieve(taskId));
      return {
        status: upstreamStatusSchema.parse(task.status),
        succeeded: task.succeeded,
        steps: task.steps,
        message: task.message,
        output: task.output,
        creditsUsed: task.creditsUsed,
      };
    },

    async sendMessage(taskId, message) {
      await call(() => client.tasks.sendMessage(taskId, { message }));
    },

    async stopTask(taskId) {
      await call(() => client.tasks.stop(taskId));
    },

    async getStream(deviceId) {
      const device = await call(() => client.devices.retrieve(deviceId));
      return device.streamUrl && device.streamToken
        ? { streamUrl: device.streamUrl, streamToken: device.streamToken }
        : undefined;
    },
  };
}
