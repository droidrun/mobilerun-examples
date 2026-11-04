import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type UserRow = { id: number; email: string };

/** Users and the one device each of them owns. This is the ownership source of truth. */
export type PortalStore = {
  upsertUser(email: string): UserRow;
  findUser(id: number): UserRow | undefined;
  getDeviceId(userId: number): string | undefined;
  /** Returns false when the user or the device id is already linked. */
  insertDevice(userId: number, deviceId: string): boolean;
  /** Removes the link only if it still points at this device. */
  deleteDevice(userId: number, deviceId: string): void;
  close(): void;
};

export function createPortalStore(path: string): PortalStore {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS devices (
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
      device_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )
  `);

  const upsertUser = db.query<UserRow, [string, string]>(
    `INSERT INTO users (email, created_at) VALUES (?, ?)
       ON CONFLICT (email) DO UPDATE SET email = excluded.email
       RETURNING id, email`,
  );
  const userById = db.query<UserRow, [number]>(
    'SELECT id, email FROM users WHERE id = ?',
  );
  const deviceByUser = db.query<{ device_id: string }, [number]>(
    'SELECT device_id FROM devices WHERE user_id = ?',
  );
  const insertDeviceRow = db.query(
    'INSERT OR IGNORE INTO devices (user_id, device_id, created_at) VALUES (?, ?, ?)',
  );
  const deleteDeviceRow = db.query(
    'DELETE FROM devices WHERE user_id = ? AND device_id = ?',
  );

  return {
    upsertUser(email) {
      const row = upsertUser.get(email, new Date().toISOString());
      if (!row) throw new Error('User upsert failed.');
      return row;
    },
    findUser(id) {
      return userById.get(id) ?? undefined;
    },
    getDeviceId(userId) {
      return deviceByUser.get(userId)?.device_id;
    },
    insertDevice(userId, deviceId) {
      return (
        insertDeviceRow.run(userId, deviceId, new Date().toISOString())
          .changes === 1
      );
    },
    deleteDevice(userId, deviceId) {
      deleteDeviceRow.run(userId, deviceId);
    },
    close() {
      db.close();
    },
  };
}
