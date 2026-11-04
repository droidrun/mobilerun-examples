import { brand } from './brand';
import { AdminPanel } from './client/components/admin-panel';
import { BrandMark } from './client/components/brand-mark';
import { DeviceCard } from './client/components/device-card';
import { SignIn } from './client/components/sign-in';
import { usePortal } from './client/use-portal';

export function App() {
  const portal = usePortal();
  const { session, device } = portal;

  if (portal.booting) {
    return <main className="auth"><p className="muted">Loading…</p></main>;
  }

  if (!session) {
    return (
      <>
        {!portal.sdkConfigured ? <ApiKeyMissing /> : null}
        <SignIn
          busy={portal.busy}
          error={portal.error}
          onSignIn={(email) => void portal.signIn(email)}
        />
      </>
    );
  }

  return (
    <main className="shell">
      {!portal.sdkConfigured ? <ApiKeyMissing /> : null}
      <header className="topbar">
        <BrandMark />
        <div className="topbar-user">
          <span className="muted">{session.email}</span>
          <button
            className="button"
            type="button"
            disabled={portal.busy}
            onClick={() => void portal.signOut()}
          >
            Sign out
          </button>
        </div>
      </header>

      {portal.error ? (
        <p className="error banner" role="alert">{portal.error}</p>
      ) : null}

      {device ? (
        <DeviceCard
          device={device}
          busy={portal.busy}
          onAction={(action) => void portal.act(action)}
          onTerminate={() => void portal.terminate()}
        />
      ) : portal.deviceLoaded ? (
        <section className="card empty">
          <h2>{brand.tagline}</h2>
          <p className="muted">
            You do not have a phone yet. Get one and open it right here.
          </p>
          <button
            className="button primary"
            type="button"
            disabled={portal.busy}
            onClick={() => void portal.createDevice()}
          >
            {portal.busy ? 'Setting up…' : 'Get my phone'}
          </button>
        </section>
      ) : (
        <p className="muted">Loading your phone…</p>
      )}

      {session.isAdmin ? <AdminPanel /> : null}
    </main>
  );
}

function ApiKeyMissing() {
  return (
    <p className="error banner" role="alert">
      API key missing: set <code>MOBILERUN_API_KEY</code> in <code>.env</code>{' '}
      and restart the server. Phones cannot be managed until then.
    </p>
  );
}
