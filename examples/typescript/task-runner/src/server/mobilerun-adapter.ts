import Mobilerun from '@mobilerun/sdk';
import {
  taskStatusSchema,
  type RunTaskRequest,
} from '@/shared/contracts';
import type { TaskServiceDeps } from './task-service';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    observations: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['summary', 'observations'],
  additionalProperties: false,
} as const;

const LLM_MODEL = 'google/gemini-3.1-flash-lite';

export function createMobilerunTaskDeps(client: Mobilerun): TaskServiceDeps {
  return {
    async runTask(input: RunTaskRequest) {
      const result = await client.tasks.run({
        ...input,
        llmModel: LLM_MODEL,
        outputSchema: OUTPUT_SCHEMA,
      });
      return {
        id: result.id,
        status: taskStatusSchema.parse(result.status),
        streamUrl: result.streamUrl,
      };
    },
    async listDevices() {
      const response = await client.devices.list({
        pageSize: 100,
        state: ['ready', 'assigned'],
      });
      return response.items ?? [];
    },
    async retrieveTask(taskId) {
      const response = await client.tasks.retrieve(taskId);
      return {
        task: {
          id: response.task.id,
          deviceId: response.task.deviceId,
          status: response.task.status
            ? taskStatusSchema.parse(response.task.status)
            : undefined,
          succeeded: response.task.succeeded,
          steps: response.task.steps,
          output: response.task.output,
          finishedAt: response.task.finishedAt,
        },
      };
    },
    async retrieveDevice(deviceId) {
      const device = await client.devices.retrieve(deviceId);
      return {
        streamUrl: device.streamUrl,
        streamToken: device.streamToken,
      };
    },
    stopTask(taskId) {
      return client.tasks.stop(taskId);
    },
  };
}
