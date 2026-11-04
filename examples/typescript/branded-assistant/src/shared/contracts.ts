import { z } from 'zod';

/** The assistant's own run states. Mobilerun task ids and statuses stay server-side. */
export const runStatusSchema = z.enum([
  'starting',
  'running',
  'cancelling',
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
  kind: z.enum(['status', 'agent', 'user']),
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
  /** Set while the agent's latest message is a question the user can answer. */
  question: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  message: z.string().nullable(),
  reserved: z.number().int().nonnegative(),
  /** Credits charged once the run settles; null while it is still running. */
  charged: z.number().int().nonnegative().nullable(),
  /** The user's balance after this run's reservation or settlement. */
  balance: z.number().int(),
  createdAt: z.string(),
  streamUrl: z.string().min(1).optional(),
  streamToken: z.string().min(1).optional(),
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
