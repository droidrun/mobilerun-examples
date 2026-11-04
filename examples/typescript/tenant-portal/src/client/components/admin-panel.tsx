import { useEffect, useState } from 'react';
import type { AdminOverview } from '@/shared/contracts';
import { portalApi } from '../api-client';
import { stateLabel } from '../state-label';

/** Operator view: every user and the state of their device. */
export function AdminPanel() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    portalApi
      .adminUsers(controller.signal)
      .then(setOverview)
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => controller.abort();
  }, []);

  return (
    <section className="card" aria-label="Admin overview">
      <h2>Customers</h2>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {overview ? (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Joined</th>
              <th>Phone</th>
            </tr>
          </thead>
          <tbody>
            {overview.users.map((user) => (
              <tr key={user.email}>
                <td>{user.email}</td>
                <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                <td>{user.device ? stateLabel(user.device.state) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : error ? null : (
        <p className="muted">Loading…</p>
      )}
    </section>
  );
}
