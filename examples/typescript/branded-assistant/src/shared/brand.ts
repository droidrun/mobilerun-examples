import { z } from 'zod';
import brandJson from '../../brand.json';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb color.');

export const brandSchema = z.object({
  name: z.string().trim().min(1).max(40),
  /** Inline SVG markup. It is rendered through an <img> data URI, never injected as HTML. */
  logoSvg: z
    .string()
    .trim()
    .startsWith('<svg')
    .max(8_000),
  colors: z.object({
    primary: hexColor,
    background: hexColor,
  }),
});

export type Brand = z.infer<typeof brandSchema>;

/** The end-user brand, validated once at module load (server and browser). */
export const brand: Brand = brandSchema.parse(brandJson);
