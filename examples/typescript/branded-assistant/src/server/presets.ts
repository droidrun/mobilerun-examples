import { z } from 'zod';
import type { OutputFieldType, PublicPreset } from '@/shared/contracts';

/**
 * Request presets. Each preset's output is a zod schema: it becomes the task's
 * JSON Schema (`z.toJSONSchema`), validates the task's output, and, through
 * `title`, labels the result card in the browser.
 */
export type Preset = {
  id: string;
  label: string;
  hint: string;
  instruction: string;
  output: z.ZodObject;
};

const text = (title: string, description: string) =>
  z.string().meta({ title, description });
const list = (title: string, description: string) =>
  z.array(z.string()).meta({ title, description });

export const presets: ReadonlyArray<Preset> = [
  {
    id: 'cheapest-hotel',
    label: 'Cheapest hotel',
    hint: 'City and dates, e.g. Lisbon, 12–15 May, 2 adults',
    instruction:
      'Open Chrome and use a hotel comparison site to find the cheapest well-rated hotel (rating 7/10 or higher) for the stay below. Do not book anything.',
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
    hint: 'Route and dates, e.g. Berlin to Lisbon, 12 May, return 15 May',
    instruction:
      'Open Chrome and use a flight search site to find the three cheapest flight options for the trip below. Do not book anything.',
    output: z.strictObject({
      cheapest: text('Cheapest', 'One-line summary of the cheapest option with price'),
      options: list('Top options', 'Up to three options, each as airline, times, stops and price'),
      sourceSite: text('Found on', 'Name of the site used'),
      notes: list('Good to know', 'Baggage rules, layovers or other caveats'),
    }),
  },
  {
    id: 'ask-anything',
    label: 'Ask anything',
    hint: 'Describe what you want checked on the phone',
    instruction:
      'Open Chrome and research the travel question below. Stay on public pages only.',
    output: z.strictObject({
      answer: text('Answer', 'A short, direct answer'),
      details: list('Details', 'Supporting facts, each one short'),
      sources: list('Sources', 'Names of the sites the answer came from'),
    }),
  },
];

type JsonSchemaProperty = { title?: string; type?: string };

/** The task's structured-output JSON Schema. */
export function outputSchemaFor(preset: Preset): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(preset.output);
  return schema;
}

function fieldType(type: string | undefined): OutputFieldType {
  if (type === 'array') return 'list';
  return type === 'number' || type === 'integer' ? 'number' : 'text';
}

/** What the browser needs to render a result card: no prompts, no schema internals. */
export function publicPresets(
  items: ReadonlyArray<Preset>,
): Array<PublicPreset> {
  return items.map((preset) => {
    const properties = (
      z.toJSONSchema(preset.output) as {
        properties?: Record<string, JsonSchemaProperty>;
      }
    ).properties;
    return {
      id: preset.id,
      label: preset.label,
      hint: preset.hint,
      fields: Object.entries(properties ?? {}).map(([key, property]) => ({
        key,
        label: property.title ?? key,
        type: fieldType(property.type),
      })),
    };
  });
}
