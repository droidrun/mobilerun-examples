import { useState } from 'react';
import { brand } from '@/brand';
import { BrandMark } from './brand-mark';

type SignInProps = {
  busy: boolean;
  error: string | null;
  onSignIn: (email: string) => void;
};

export function SignIn({ busy, error, onSignIn }: SignInProps) {
  const [email, setEmail] = useState('');

  return (
    <main className="auth">
      <form
        className="auth-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSignIn(email);
        }}
      >
        <BrandMark />
        <h1>{brand.tagline}</h1>
        <p>Sign in to open your phone.</p>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <small className="hint">
          Demo sign-in: any email works. A real product would use its own
          identity provider here.
        </small>
      </form>
    </main>
  );
}
