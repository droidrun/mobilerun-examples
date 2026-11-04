import { describe, expect, test } from 'bun:test';
import { brandSchema, brand } from '@/shared/brand';
import { readableOn } from '@/shared/color';
import {
  assistantConfig,
  assistantConfigSchema,
  outputSchemaFor,
  publicPersona,
  publicPresets,
  systemPromptFor,
} from './assistant-config';

const preset = {
  id: 'hotel',
  label: 'Hotel',
  instruction: 'Find a hotel.',
  outputFields: [{ key: 'name', label: 'Name', type: 'text', description: 'Hotel name' }],
};
const base = {
  persona: { displayName: 'Pip', tone: 'warm' },
  systemPrompt: 'Be helpful.',
  presets: [preset],
};

describe('assistant.json', () => {
  test('the shipped persona is valid and has 2–3 presets', () => {
    expect(assistantConfig.presets.length).toBeGreaterThanOrEqual(2);
    expect(assistantConfig.presets.length).toBeLessThanOrEqual(3);
  });

  test('applies defaults for step and time limits', () => {
    expect(assistantConfigSchema.parse(base)).toMatchObject({
      maxSteps: 30,
      executionTimeout: 600,
    });
  });

  test('rejects invalid personas', () => {
    for (const broken of [
      { ...base, presets: [] },
      { ...base, systemPrompt: '' },
      { ...base, maxSteps: 0 },
      { ...base, executionTimeout: 9_999 },
      { ...base, presets: [preset, preset] },
      { ...base, presets: [{ ...preset, id: 'Has Spaces' }] },
      { ...base, presets: [{ ...preset, outputFields: [] }] },
      {
        ...base,
        presets: [
          {
            ...preset,
            outputFields: [preset.outputFields[0], preset.outputFields[0]],
          },
        ],
      },
    ]) {
      expect(assistantConfigSchema.safeParse(broken).success).toBe(false);
    }
  });

  test('describes each preset output as a strict JSON schema', () => {
    const schema = outputSchemaFor(assistantConfig.presets[0]!);
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema).not.toHaveProperty('$schema');
    expect(Object.keys(schema.properties as object)).toEqual(
      assistantConfig.presets[0]!.outputFields.map((field) => field.key),
    );
    expect(schema.required).toEqual(
      assistantConfig.presets[0]!.outputFields.map((field) => field.key),
    );
  });

  test('maps field types to JSON schema types', () => {
    const schema = outputSchemaFor(
      assistantConfigSchema.parse({
        ...base,
        presets: [
          {
            ...preset,
            outputFields: [
              { key: 'a', label: 'A', type: 'text', description: 'a' },
              { key: 'b', label: 'B', type: 'number', description: 'b' },
              { key: 'c', label: 'C', type: 'list', description: 'c' },
            ],
          },
        ],
      }).presets[0]!,
    );
    expect(schema.properties).toMatchObject({
      a: { type: 'string', description: 'a' },
      b: { type: 'number' },
      c: { type: 'array', items: { type: 'string' } },
    });
  });

  test('the public view carries no prompt, tone, model or instruction', () => {
    const exposed = JSON.stringify([
      publicPersona(assistantConfig),
      publicPresets(assistantConfig),
    ]);
    expect(exposed).not.toContain(assistantConfig.systemPrompt.slice(0, 40));
    expect(exposed).not.toContain(assistantConfig.persona.tone);
    expect(exposed).not.toContain('instruction');
    expect(systemPromptFor(assistantConfig)).toContain(assistantConfig.persona.tone);
  });
});

describe('brand.json', () => {
  test('the shipped brand is valid', () => {
    expect(brand.name.length).toBeGreaterThan(0);
  });

  test('rejects bad colors and logos that are not SVG', () => {
    const valid = { name: 'Acme', logoSvg: '<svg></svg>', colors: { primary: '#000000', background: '#ffffff' } };
    expect(brandSchema.safeParse(valid).success).toBe(true);
    expect(brandSchema.safeParse({ ...valid, colors: { ...valid.colors, primary: 'red' } }).success).toBe(false);
    expect(brandSchema.safeParse({ ...valid, logoSvg: '<img src=x>' }).success).toBe(false);
  });

  test('picks a readable text color for a background', () => {
    expect(readableOn('#ffffff')).toBe('#111111');
    expect(readableOn('#0f766e')).toBe('#ffffff');
    expect(readableOn('#000000')).toBe('#ffffff');
  });
});
