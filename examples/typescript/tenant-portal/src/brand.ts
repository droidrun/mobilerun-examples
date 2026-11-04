import brandConfig from '../brand.json';

export type Brand = typeof brandConfig;

export const brand: Brand = brandConfig;

/**
 * Map brand.json onto the CSS variables the portal and @mobilerun/react read,
 * so the live device stream follows the reseller's colors.
 */
export function applyBrand(root: HTMLElement = document.documentElement): void {
  const { primary, primaryForeground, background, foreground } = brand.colors;
  const variables: Record<string, string> = {
    '--background': background,
    '--foreground': foreground,
    '--primary': primary,
    '--primary-foreground': primaryForeground,
    '--card': `color-mix(in srgb, ${foreground} 6%, ${background})`,
    '--card-foreground': foreground,
    '--muted': `color-mix(in srgb, ${foreground} 12%, ${background})`,
    '--muted-foreground': `color-mix(in srgb, ${foreground} 62%, ${background})`,
    '--accent': `color-mix(in srgb, ${primary} 18%, ${background})`,
    '--accent-foreground': foreground,
    '--border': `color-mix(in srgb, ${foreground} 16%, ${background})`,
    '--ring': primary,
  };
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
  document.title = brand.name;
}
