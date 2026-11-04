// Shared with the other white-label examples in this folder.
import brandJson from '../../brand.json';

/** Company, product name, tagline, accent color and a 24×24 SVG path for the logo mark. */
export const brand = brandJson;

/** White or near-black text, whichever reads better on a #rrggbb color. */
function inkOn(hex: string): string {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#141a16' : '#ffffff';
}

/** Sets the two brand variables once, before the first render; theme.css derives the rest. */
export function applyBrand(): void {
  if (!/^#[0-9a-f]{6}$/i.test(brand.accent)) throw new Error('brand.json: accent must be #rrggbb');
  const { style } = document.documentElement;
  style.setProperty('--accent', brand.accent);
  style.setProperty('--accent-ink', inkOn(brand.accent));
}
