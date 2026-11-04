import { describe, expect, test } from 'bun:test';
import { brandSchema } from '@/shared/contracts';
import { brandCssVariables, logoDataUri } from './brand';

const brand = brandSchema.parse(await Bun.file('brand.json').json());

describe('brand mapping', () => {
  test('maps brand colors onto the variables @mobilerun/react reads', () => {
    const variables = brandCssVariables(brand);

    expect(variables['--primary']).toBe(brand.colors.primary);
    expect(variables['--primary-foreground']).toBe(brand.colors.primaryForeground);
    expect(variables['--background']).toBe(brand.colors.background);
    expect(variables['--card']).toBe(brand.colors.card);
    expect(variables['--border']).toBe(brand.colors.border);
  });

  test('encodes the logo as an image source', () => {
    const uri = logoDataUri(brand);

    expect(uri).toStartWith('data:image/svg+xml;utf8,%3Csvg');
    expect(decodeURIComponent(uri.split(',')[1] ?? '')).toBe(brand.logoSvg);
  });
});
