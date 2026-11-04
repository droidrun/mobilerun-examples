/** Black or white, whichever reads better on the given #rrggbb background. */
export function readableOn(hex: string): '#111111' | '#ffffff' {
  const value = hex.slice(1);
  const [red = 0, green = 0, blue = 0] = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.4 ? '#111111' : '#ffffff';
}
