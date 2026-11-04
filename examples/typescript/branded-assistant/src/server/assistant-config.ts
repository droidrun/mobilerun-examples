import { z } from 'zod';
import assistantJson from '../../assistant.json';
import type { OutputFieldType, Persona, PublicPreset } from '@/shared/contracts';

const slug = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);

const outputFieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/),
  label: z.string().trim().min(1).max(40),
  type: z.enum(['text', 'number', 'list']),
  description: z.string().trim().min(1).max(200),
});

const presetSchema = z.object({
  id: slug,
  label: z.string().trim().min(1).max(40),
  hint: z.string().trim().max(160).default(''),
  instruction: z.string().trim().min(1).max(2_000),
  outputFields: z.array(outputFieldSchema).min(1).max(12),
});

export const assistantConfigSchema = z
  .object({
    persona: z.object({
      displayName: z.string().trim().min(1).max(40),
      tagline: z.string().trim().max(120).default(''),
      tone: z.string().trim().min(1).max(200),
    }),
    // Server-side only: neither the prompt nor the model id is ever serialized
    // into an API response.
    systemPrompt: z.string().trim().min(1).max(8_000),
    maxSteps: z.number().int().min(1).max(100).default(30),
    executionTimeout: z.number().int().min(1).max(2_700).default(600),
    llmModel: z.string().trim().min(1).optional(),
    presets: z.array(presetSchema).min(1).max(6),
  })
  .superRefine((config, context) => {
    const seen = new Set<string>();
    config.presets.forEach((preset, index) => {
      if (seen.has(preset.id)) {
        context.addIssue({
          code: 'custom',
          path: ['presets', index, 'id'],
          message: `Duplicate preset id "${preset.id}".`,
        });
      }
      seen.add(preset.id);
      const keys = new Set<string>();
      for (const field of preset.outputFields) {
        if (keys.has(field.key)) {
          context.addIssue({
            code: 'custom',
            path: ['presets', index, 'outputFields'],
            message: `Duplicate output key "${field.key}" in "${preset.id}".`,
          });
        }
        keys.add(field.key);
      }
    });
  });

export type AssistantConfig = z.infer<typeof assistantConfigSchema>;
export type AssistantPreset = AssistantConfig['presets'][number];

function fieldSchema(type: OutputFieldType, description: string): z.ZodType {
  switch (type) {
    case 'text':
      return z.string().describe(description);
    case 'number':
      return z.number().describe(description);
    case 'list':
      return z.array(z.string()).describe(description);
  }
}

/** The task's structured-output JSON Schema, described with zod per preset. */
export function outputSchemaFor(
  preset: AssistantPreset,
): Record<string, unknown> {
  const shape = Object.fromEntries(
    preset.outputFields.map((field) => [
      field.key,
      fieldSchema(field.type, field.description),
    ]),
  );
  const { $schema: _ignored, ...schema } = z.toJSONSchema(
    z.strictObject(shape),
  );
  return schema;
}

export function publicPersona(config: AssistantConfig): Persona {
  return {
    displayName: config.persona.displayName,
    tagline: config.persona.tagline,
  };
}

export function publicPresets(config: AssistantConfig): Array<PublicPreset> {
  return config.presets.map((preset) => ({
    id: preset.id,
    label: preset.label,
    hint: preset.hint,
    fields: preset.outputFields.map(({ key, label, type }) => ({
      key,
      label,
      type,
    })),
  }));
}

/** The prompt sent with a task: persona prompt plus the tone, built server-side. */
export function systemPromptFor(config: AssistantConfig): string {
  return `${config.systemPrompt}\n\nTone: ${config.persona.tone}.`;
}

export function taskFor(preset: AssistantPreset, request: string): string {
  return `${preset.instruction}\n\nTraveller's request: ${request}`;
}

/** The persona shipped with the example, validated once at module load. */
export const assistantConfig: AssistantConfig =
  assistantConfigSchema.parse(assistantJson);
