import { z } from 'zod';
import assistantJson from '../../assistant.json';
import type { Persona } from '@/shared/contracts';

export const assistantConfigSchema = z.object({
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
});

export type AssistantConfig = z.infer<typeof assistantConfigSchema>;

export function publicPersona(config: AssistantConfig): Persona {
  return {
    displayName: config.persona.displayName,
    tagline: config.persona.tagline,
  };
}

/** The prompt sent with a task: persona prompt plus the tone, built server-side. */
export function systemPromptFor(config: AssistantConfig): string {
  return `${config.systemPrompt}\n\nTone: ${config.persona.tone}.`;
}

// Text from the user is untrusted. It goes to the agent inside a fence the
// system prompt names as data, with angle brackets escaped so the user cannot
// close the fence early.
function fenced(tag: string, text: string): string {
  const safe = text.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<${tag}>\n${safe}\n</${tag}>`;
}

export function taskFor(instruction: string, request: string): string {
  return `${instruction}\n\n${fenced('traveller_request', request)}`;
}

export function messageFor(message: string): string {
  return fenced('traveller_message', message);
}

/** The persona shipped with the example, validated once at module load. */
export const assistantConfig: AssistantConfig =
  assistantConfigSchema.parse(assistantJson);
