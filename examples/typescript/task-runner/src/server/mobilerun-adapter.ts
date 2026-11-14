import type { MobilerunSDK } from '@mobilerun/sdk';
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

export function createMobilerunTaskDeps(sdk: MobilerunSDK): TaskServiceDeps {
  return {
    async runTask({ deviceId, ...input }: RunTaskRequest) {
      const task = await sdk.devices.fromId(deviceId).run({
        ...input,
        llmModel: LLM_MODEL,
        outputSchema: OUTPUT_SCHEMA,
      });
      return {
        id: task.id,
        status: taskStatusSchema.parse(task.status),
        streamUrl:
          task.info && 'streamUrl' in task.info
            ? task.info.streamUrl
            : undefined,
      };
    },
    async listDevices() {
      const page = await sdk.devices.list({
        pageSize: 100,
        state: ['ready', 'assigned'],
      });
      return page.items.flatMap((device) => (device.info ? [device.info] : []));
    },
    async retrieveTask(taskId) {
      const response = await sdk.tasks.fromId(taskId).refresh();
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
      const device = await sdk.devices.fromId(deviceId).refresh();
      return {
        streamUrl: device.streamUrl,
        streamToken: device.streamToken,
      };
    },
    stopTask(taskId) {
      return sdk.tasks.fromId(taskId).stop();
    },
  };
}
