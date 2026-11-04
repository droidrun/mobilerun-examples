import { brand } from '@/shared/brand';
import { readableOn } from '@/shared/color';

/**
 * Map brand.json onto the CSS variables the stream components and the page read.
 * Everything else (card, muted, border) is derived in styles.css.
 */
export function applyBrand(document: Document): void {
  const style = document.documentElement.style;
  style.setProperty('--brand-primary', brand.colors.primary);
  style.setProperty('--brand-on-primary', readableOn(brand.colors.primary));
  style.setProperty('--brand-background', brand.colors.background);
  style.setProperty('--brand-ink', readableOn(brand.colors.background));
  document.title = `${brand.name} assistant`;
}

export function logoDataUri(): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(brand.logoSvg)}`;
}
