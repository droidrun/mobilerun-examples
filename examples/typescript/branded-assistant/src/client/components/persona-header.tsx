import { brand } from '@/shared/brand';
import type { Persona } from '@/shared/contracts';
import { logoDataUri } from '../apply-brand';

type PersonaHeaderProps = {
  persona: Persona | null;
  balance: number | null;
  reservePerRun: number | null;
};

export function PersonaHeader({ persona, balance, reservePerRun }: PersonaHeaderProps) {
  return (
    <header className="persona">
      <img className="persona-logo" src={logoDataUri()} alt={brand.name} />
      <div className="persona-text">
        <h1>{persona?.displayName ?? brand.name}</h1>
        <p>{persona?.tagline ?? ''}</p>
      </div>
      {balance !== null ? (
        <div className="credits" title={reservePerRun ? `Each request holds ${reservePerRun} credits until it finishes.` : undefined}>
          <strong>{balance}</strong>
          <span>credits</span>
        </div>
      ) : null}
    </header>
  );
}
