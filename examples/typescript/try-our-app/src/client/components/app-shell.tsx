// Shared with the other white-label examples in this folder.
import type { ReactNode } from 'react';
import { brand } from '../brand';

/** Status tones. theme.css colors pills and notices by their `data-tone`. */
export type Tone = 'neutral' | 'busy' | 'live' | 'warn' | 'danger';

export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={brand.logo} />
    </svg>
  );
}

/** One line of feedback with a tone bar, such as an error next to the button that caused it. */
export function Notice({ tone = 'danger', text }: { tone?: Tone; text: string }) {
  return (
    <p className="notice" data-tone={tone} role="alert">
      {text}
    </p>
  );
}

type AppShellProps = {
  /** Context for the right end of the top bar, such as a countdown or the account. */
  right?: ReactNode;
  children: ReactNode;
};

export function AppShell({ right, children }: AppShellProps) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="wordmark">
            <BrandMark />
            {brand.product}
          </span>
          {right}
        </div>
      </header>
      <main className="content">{children}</main>
    </>
  );
}
