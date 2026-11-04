import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type User = { id: number; email: string };
export type PortalStore = ReturnType<typeof createPortalStore>;

/** Users and the one device each owns: the source of truth for who may touch which device. */
export function createPortalStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS devices (user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    device_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)`);
  const upsert = db.query<User, [string, string]>(`INSERT INTO users (email, created_at)
    VALUES (?, ?) ON CONFLICT (email) DO UPDATE SET email = excluded.email RETURNING id, email`);
  const user = db.query<User, [number]>('SELECT id, email FROM users WHERE id = ?');
  const device = db.query<{ device_id: string }, [number]>(
    'SELECT device_id FROM devices WHERE user_id = ?',
  );
  const link = db.query('INSERT OR IGNORE INTO devices VALUES (?, ?, ?)');
  const unlink = db.query('DELETE FROM devices WHERE user_id = ? AND device_id = ?');
  const now = () => new Date().toISOString();

  return {
    upsertUser: (email: string) => upsert.get(email, now()) as User,
    findUser: (id: number) => user.get(id) ?? undefined,
    deviceId: (userId: number) => device.get(userId)?.device_id,
    /** False when the user already has a device or the device already has an owner. */
    link: (userId: number, deviceId: string) => link.run(userId, deviceId, now()).changes === 1,
    /** Removes the link only while it still points at this device. */
    unlink(userId: number, deviceId: string): void {
      unlink.run(userId, deviceId);
    },
    close: () => db.close(),
  };
}
