import type { Brand } from '@/shared/contracts';

/** Black or white, whichever reads better on the given #rrggbb color. */
export function readableOn(hex: string): string {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map(
    (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.55 ? '#111111' : '#ffffff';
}

/**
 * The only two colors a brand picks. `styles.css` derives every variable that
 * `@mobilerun/react` reads (card, border, muted, …) from these.
 */
export function brandCssVariables(brand: Brand): Record<string, string> {
  return {
    '--brand-primary': brand.primary,
    '--brand-on-primary': readableOn(brand.primary),
    '--brand-background': brand.background,
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
  return `data:image/svg+xml;utf8,${encodeURIComponent(brand.logo)}`;
}
