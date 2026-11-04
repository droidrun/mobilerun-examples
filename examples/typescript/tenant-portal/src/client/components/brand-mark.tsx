import { brand } from '@/brand';

export function BrandMark() {
  return (
    <span className="brand">
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path d={brand.logoPath} fill="currentColor" />
      </svg>
      <span>{brand.name}</span>
    </span>
  );
}
