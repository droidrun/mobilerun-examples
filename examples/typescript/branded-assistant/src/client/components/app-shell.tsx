// Shared by the white-label examples (try-our-app, tenant-portal, branded-assistant). Keep identical.
import type { ReactNode } from 'react';
import { brand } from '../brand';

export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={brand.logo} />
    </svg>
  );
}

type AppShellProps = {
  product: string;
  /** Context for the right end of the top bar, such as a countdown or the account. */
  right?: ReactNode;
  children: ReactNode;
};

export function AppShell({ product, right, children }: AppShellProps) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="wordmark">
            <BrandMark />
            {product}
          </span>
          {right}
        </div>
      </header>
      <main className="content">{children}</main>
    </>
  );
}
