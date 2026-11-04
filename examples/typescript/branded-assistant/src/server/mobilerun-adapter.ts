import type Mobilerun from '@mobilerun/sdk';
import type { AssistantDeps } from './assistant-deps';
import { upstreamStatusSchema } from './progress';

/**
 * The only module that touches @mobilerun/sdk. SDK errors pass through
 * unchanged: callers read `error.status`.
 */
export function createMobilerunAssistantDeps(
  client: Mobilerun,
): AssistantDeps {
  return {
    async startTask(input) {
      // No retries: a retried start could create the task twice.
      const response = await client.tasks.run(input, { maxRetries: 0 });
      return { taskId: response.id };
    },

    async getStatus(taskId) {
      const response = await client.tasks.getStatus(taskId);
      return {
        status: upstreamStatusSchema.parse(response.status),
        succeeded: response.succeeded,
        steps: response.steps,
        message: response.message,
      };
    },

    async retrieveTask(taskId) {
      const { task } = await client.tasks.retrieve(taskId);
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
      const response = await client.tasks.sendMessage(taskId, { message });
      return response.sent;
    },

    async stopTask(taskId) {
      await client.tasks.stop(taskId);
    },
  };
}
