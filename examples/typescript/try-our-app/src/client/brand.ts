import type { Brand } from '@/shared/contracts';

/**
 * Maps the brand colors onto the CSS variables the `@mobilerun/react`
 * components read, plus a few the page itself uses.
 */
export function brandCssVariables(brand: Brand): Record<string, string> {
  const { colors } = brand;
  return {
    '--background': colors.background,
    '--foreground': colors.foreground,
    '--card': colors.card,
    '--card-foreground': colors.foreground,
    '--muted': colors.muted,
    '--muted-foreground': colors.mutedForeground,
    '--border': colors.border,
    '--primary': colors.primary,
    '--primary-foreground': colors.primaryForeground,
    '--accent': colors.muted,
    '--accent-foreground': colors.foreground,
    '--ring': colors.primary,
  };
}

export function applyBrand(brand: Brand, root: HTMLElement): void {
  for (const [name, value] of Object.entries(brandCssVariables(brand))) {
    root.style.setProperty(name, value);
  }
  document.title = `Try ${brand.name}`;
}

/** An <img> source keeps the brand's SVG from running as page markup. */
export function logoDataUri(brand: Brand): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(brand.logoSvg)}`;
}
