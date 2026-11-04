import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type UserRow = { id: number; email: string; createdAt: string };

export type UserWithDevice = UserRow & { deviceId: string | null };

/** Users and the one device each of them owns. This is the ownership source of truth. */
export type PortalStore = {
  upsertUser(email: string): UserRow;
  findUser(id: number): UserRow | undefined;
  getDeviceId(userId: number): string | undefined;
  countDevices(userId: number): number;
  /** Returns false when the user or the device id is already linked. */
  insertDevice(userId: number, deviceId: string): boolean;
  deleteDevice(userId: number): void;
  listUsersWithDevices(): Array<UserWithDevice>;
  close(): void;
};

type RawUser = { id: number; email: string; created_at: string };

function toUser(row: RawUser): UserRow {
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

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

  const insertUser = db.query(
    'INSERT OR IGNORE INTO users (email, created_at) VALUES (?, ?)',
  );
  const userByEmail = db.query<RawUser, [string]>(
    'SELECT id, email, created_at FROM users WHERE email = ?',
  );
  const userById = db.query<RawUser, [number]>(
    'SELECT id, email, created_at FROM users WHERE id = ?',
  );
  const deviceByUser = db.query<{ device_id: string }, [number]>(
    'SELECT device_id FROM devices WHERE user_id = ?',
  );
  const countByUser = db.query<{ total: number }, [number]>(
    'SELECT COUNT(*) AS total FROM devices WHERE user_id = ?',
  );
  const insertDeviceRow = db.query(
    'INSERT OR IGNORE INTO devices (user_id, device_id, created_at) VALUES (?, ?, ?)',
  );
  const deleteDeviceRow = db.query('DELETE FROM devices WHERE user_id = ?');
  const allUsers = db.query<RawUser & { device_id: string | null }, []>(
    `SELECT u.id, u.email, u.created_at, d.device_id
       FROM users u LEFT JOIN devices d ON d.user_id = u.id
      ORDER BY u.id`,
  );

  return {
    upsertUser(email) {
      insertUser.run(email, new Date().toISOString());
      const row = userByEmail.get(email);
      if (!row) throw new Error('User upsert failed.');
      return toUser(row);
    },
    findUser(id) {
      const row = userById.get(id);
      return row ? toUser(row) : undefined;
    },
    getDeviceId(userId) {
      return deviceByUser.get(userId)?.device_id;
    },
    countDevices(userId) {
      return countByUser.get(userId)?.total ?? 0;
    },
    insertDevice(userId, deviceId) {
      const result = insertDeviceRow.run(
        userId,
        deviceId,
        new Date().toISOString(),
      );
      return result.changes === 1;
    },
    deleteDevice(userId) {
      deleteDeviceRow.run(userId);
    },
    listUsersWithDevices() {
      return allUsers.all().map((row) => ({
        ...toUser(row),
        deviceId: row.device_id,
      }));
    },
    close() {
      db.close();
    },
  };
}
