import { z } from 'zod';

export const taskStatusSchema = z.enum([
  'queued',
  'created',
  'running',
  'cancelling',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const runTaskRequestSchema = z
  .object({
    task: z.string().trim().min(1).max(8_000),
    deviceId: z.uuid(),
    maxSteps: z.number().int().min(1).max(100).default(30),
  })
  .strict();

export type RunTaskRequest = z.infer<typeof runTaskRequestSchema>;

const streamFields = {
  streamUrl: z.string().min(1).optional(),
  streamToken: z.string().min(1).optional(),
};

export const runTaskResponseSchema = z.object({
  id: z.string().min(1),
  status: taskStatusSchema,
  ...streamFields,
});

export type RunTaskResponse = z.infer<typeof runTaskResponseSchema>;

export const taskOutputSchema = z.record(z.string(), z.unknown());

export const taskViewSchema = z.object({
  id: z.string().min(1),
  status: taskStatusSchema,
  succeeded: z.boolean().nullable(),
  steps: z.number().int().nonnegative().nullable(),
  output: taskOutputSchema.nullable(),
  finishedAt: z.string().nullable(),
  ...streamFields,
});

export type TaskView = z.infer<typeof taskViewSchema>;

export const deviceSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.string().min(1),
  type: z.string().min(1),
});

export type DeviceSummary = z.infer<typeof deviceSummarySchema>;

export const deviceListResponseSchema = z.object({
  items: z.array(deviceSummarySchema),
});

export const cancelTaskResponseSchema = z.object({
  cancelled: z.boolean(),
});

export type CancelTaskResponse = z.infer<typeof cancelTaskResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
