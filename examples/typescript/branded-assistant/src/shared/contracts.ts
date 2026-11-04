import { z } from 'zod';

/** The assistant's own run states. Mobilerun task ids and statuses stay server-side. */
export const runStatusSchema = z.enum([
  'starting',
  'running',
  'cancelling',
  /** The API did not confirm whether the task started; the server is reconciling. */
  'unknown',
  'completed',
  'failed',
  'cancelled',
]);

export type RunStatus = z.infer<typeof runStatusSchema>;

export function isTerminalStatus(status: RunStatus): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  );
}

export const outputFieldTypeSchema = z.enum(['text', 'number', 'list']);

export type OutputFieldType = z.infer<typeof outputFieldTypeSchema>;

/** What the browser needs to render a result card. No prompts, no model ids. */
export const publicPresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  hint: z.string(),
  fields: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      type: outputFieldTypeSchema,
    }),
  ),
});

export type PublicPreset = z.infer<typeof publicPresetSchema>;

export const personaSchema = z.object({
  displayName: z.string().min(1),
  tagline: z.string(),
});

export type Persona = z.infer<typeof personaSchema>;

export const startRunRequestSchema = z
  .object({
    presetId: z.string().min(1).max(64),
    message: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type StartRunRequest = z.infer<typeof startRunRequestSchema>;

export const sendMessageRequestSchema = z
  .object({ message: z.string().trim().min(1).max(1_000) })
  .strict();

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const timelineEntrySchema = z.object({
  at: z.string(),
  kind: z.enum(['status', 'user']),
  text: z.string(),
});

export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const runViewSchema = z.object({
  id: z.string().min(1),
  presetId: z.string().min(1),
  request: z.string(),
  status: runStatusSchema,
  steps: z.number().int().nonnegative().nullable(),
  timeline: z.array(timelineEntrySchema),
  /** The task output, only when it matches the preset's schema. */
  result: z.record(z.string(), z.unknown()).nullable(),
  /** Output that did not match the schema, as capped JSON text for display. */
  rawOutput: z.string().nullable(),
  message: z.string().nullable(),
  /** Set while the server cannot reach the backend for this run. */
  error: z.string().nullable(),
  /** Credits charged once the run settles; null while it is still active. */
  charged: z.number().int().nonnegative().nullable(),
  /** The user's balance after this run's reservation or settlement. */
  balance: z.number().int(),
});

export type RunView = z.infer<typeof runViewSchema>;

export const sessionViewSchema = z.object({
  persona: personaSchema,
  presets: z.array(publicPresetSchema),
  balance: z.number().int(),
  reservePerRun: z.number().int().positive(),
  sdkConfigured: z.boolean(),
  deviceCount: z.number().int().nonnegative(),
  runs: z.array(runViewSchema),
});

export type SessionView = z.infer<typeof sessionViewSchema>;

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
