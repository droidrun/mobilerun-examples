import { describe, expect, test } from 'bun:test';
import { brand } from '@/shared/brand';
import { brandSchema } from '@/shared/contracts';
import { brandCssVariables, logoDataUri, readableOn } from './brand';

describe('brand', () => {
  test('the bundled brand is valid and rejects unsafe colors', () => {
    expect(brand.name).toBe('Fernly');
    expect(
      brandSchema.safeParse({ ...brand, primary: 'red; background: url(x)' })
        .success,
    ).toBe(false);
  });

  test('exposes the two brand colors and a readable text color', () => {
    expect(brandCssVariables(brand)).toEqual({
      '--brand-primary': brand.primary,
      '--brand-on-primary': '#ffffff',
      '--brand-background': brand.background,
    });
    expect(readableOn('#ffd200')).toBe('#111111');
  });

  test('encodes the logo as an image source', () => {
    const uri = logoDataUri(brand);

    expect(uri).toStartWith('data:image/svg+xml;utf8,%3Csvg');
    expect(decodeURIComponent(uri.split(',')[1] ?? '')).toBe(brand.logo);
  });
});
