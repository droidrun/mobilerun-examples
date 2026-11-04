import { brand } from '@/shared/brand';
import type { ConversationState } from '../conversation-machine';
import { logoDataUri } from '../apply-brand';

type PersonaHeaderProps = Pick<
  ConversationState,
  'persona' | 'balance' | 'reservePerRun'
>;

export function PersonaHeader({ persona, balance, reservePerRun }: PersonaHeaderProps) {
  return (
    <header className="persona">
      <img className="persona-logo" src={logoDataUri()} alt={brand.name} />
      <div className="persona-text">
        <h1>{persona?.displayName ?? brand.name}</h1>
        <p>{persona?.tagline ?? ''}</p>
      </div>
      {balance !== null ? (
        <div
          className="credits"
          title={reservePerRun ? `Each request holds ${reservePerRun} credits until it finishes.` : undefined}
        >
          <strong>{balance}</strong>
          <span>credits</span>
        </div>
      ) : null}
    </header>
  );
}
