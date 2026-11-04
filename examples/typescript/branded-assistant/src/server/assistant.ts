import { z } from 'zod';
import assistantJson from '../../assistant.json';
import type { Result } from '@/shared/contracts';

/** Persona, prompt and limits. Only `name` and `role` ever reach the browser. */
export const assistant = z
  .object({
    name: z.string().trim().min(1).max(40),
    role: z.string().trim().max(120),
    tone: z.string().trim().min(1).max(200),
    systemPrompt: z.string().trim().min(1).max(8_000),
    maxSteps: z.number().int().min(1).max(100),
    executionTimeout: z.number().int().min(1).max(2_700),
    llmModel: z.string().trim().min(1).optional(),
  })
  .parse(assistantJson);

export const systemPrompt = `${assistant.systemPrompt}\n\nTone: ${assistant.tone}.`;

/**
 * Each preset's output is a zod schema: it becomes the task's JSON Schema, validates
 * what comes back, and its `title`s label the result rows.
 */
export type Preset = {
  id: string;
  label: string;
  hint: string;
  instruction: string;
  output: z.ZodObject;
};

const text = (title: string, description: string) => z.string().meta({ title, description });
const list = (title: string, description: string) =>
  z.array(z.string()).meta({ title, description });

export const presets: ReadonlyArray<Preset> = [
  {
    id: 'cheapest-hotel',
    label: 'Cheapest hotel',
    hint: 'City and dates, e.g. Lisbon, 12–15 May, 2 adults',
    instruction:
      'Open Chrome and use a hotel comparison site to find the cheapest well-rated hotel ' +
      '(rating 7/10 or higher) for the stay below. Do not book anything.',
    output: z.strictObject({
      hotelName: text('Hotel', 'Name of the cheapest suitable hotel'),
      pricePerNight: text('Per night', 'Price per night with currency'),
      totalPrice: text('Total', 'Total price for the stay with currency'),
      rating: text('Rating', 'Guest rating as shown on the site'),
      sourceSite: text('Found on', 'Name of the site where the price was found'),
      notes: list('Good to know', 'Cancellation terms, fees or other caveats'),
    }),
  },
  {
    id: 'flight-deals',
    label: 'Flight deals',
    hint: 'Route and dates, e.g. Berlin to Lisbon, 12 May, back 15 May',
    instruction:
      'Open Chrome and use a flight search site to find the three cheapest flight options ' +
      'for the trip below. Do not book anything.',
    output: z.strictObject({
      cheapest: text('Cheapest', 'One-line summary of the cheapest option with price'),
      options: list('Top options', 'Up to three options: airline, times, stops and price'),
      sourceSite: text('Found on', 'Name of the site used'),
      notes: list('Good to know', 'Baggage rules, layovers or other caveats'),
    }),
  },
  {
    id: 'ask-anything',
    label: 'Ask anything',
    hint: 'A travel question, e.g. Do I need a visa for Japan?',
    instruction:
      'Open Chrome and research the travel question below. Stay on public pages only.',
    output: z.strictObject({
      answer: text('Answer', 'A short, direct answer'),
      details: list('Details', 'Supporting facts, each one short'),
      sources: list('Sources', 'Names of the sites the answer came from'),
    }),
  },
];

/** The task's structured-output JSON Schema. */
export function outputSchemaFor(preset: Preset): Record<string, unknown> {
  const { $schema: _, ...schema } = z.toJSONSchema(preset.output);
  return schema;
}

/** What an agent writes when it found nothing. */
const EMPTY = /^(|-|—|n\/?a|none|unknown|not found|not available)$/i;
const isFound = (text: string) => !EMPTY.test(text.trim());

/** Output that passed `safeParse`: found values as labelled rows, the rest by label. */
export function resultOf(preset: Preset, output: Record<string, unknown>): Result {
  const result: Result = { rows: [], missing: [] };
  for (const [key, field] of Object.entries(preset.output.shape)) {
    const label = field.meta()?.title ?? key;
    const raw = output[key];
    const value = Array.isArray(raw) ? raw.map(String).filter(isFound) : String(raw ?? '');
    if (Array.isArray(value) ? value.length : isFound(value)) result.rows.push({ label, value });
    else result.missing.push(label);
  }
  return result;
}

// User text is untrusted. It reaches the agent inside a fence that the system prompt
// names as data, with angle brackets escaped so the text cannot close the fence.
const fence = (tag: string, text: string) =>
  `<${tag}>\n${text.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}\n</${tag}>`;
export const taskFor = (preset: Preset, request: string) =>
  `${preset.instruction}\n\n${fence('traveller_request', request)}`;
export const noteFor = (note: string) => fence('traveller_message', note);
