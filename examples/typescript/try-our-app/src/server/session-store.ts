import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * `ending` means a terminate is owed: the row stays open (and keeps its
 * concurrency slot) until the device is confirmed gone.
 */
export type SessionState = 'provisioning' | 'live' | 'ending' | 'ended';
export type CloseReason = 'user' | 'expired' | 'failed' | 'shutdown';

export type SessionRecord = {
  id: string;
  visitorId: string;
  deviceId: string | null;
  state: SessionState;
  createdAt: number;
  expiresAt: number;
  endReason: CloseReason | null;
};

export type SessionPatch = Partial<
  Pick<SessionRecord, 'deviceId' | 'state' | 'expiresAt' | 'endReason'>
>;

export interface SessionStore {
  insert: (record: SessionRecord) => void;
  get: (id: string) => SessionRecord | undefined;
  /** The visitor's session that is booting or running. */
  findActiveByVisitor: (visitorId: string) => SessionRecord | undefined;
  countOpen: () => number;
  listOpen: () => Array<SessionRecord>;
  update: (id: string, patch: SessionPatch) => void;
  close: () => void;
}

type Row = {
  id: string;
  visitor_id: string;
  device_id: string | null;
  state: SessionState;
  created_at: number;
  expires_at: number;
  end_reason: CloseReason | null;
};

function toRecord(row: Row): SessionRecord {
  return {
    id: row.id,
    visitorId: row.visitor_id,
    deviceId: row.device_id,
    state: row.state,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    endReason: row.end_reason,
  };
}

/**
 * Sessions live in SQLite so a restarted server still knows which devices it
 * owes a `terminate`. Pass `:memory:` for tests.
 */
export function createSessionStore(path: string): SessionStore {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      device_id TEXT,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      end_reason TEXT
    )
  `);

  const insert = db.query(
    `INSERT INTO sessions (id, visitor_id, device_id, state, created_at, expires_at, end_reason)
     VALUES ($id, $visitorId, $deviceId, $state, $createdAt, $expiresAt, $endReason)`,
  );
  const select = db.query<Row, [string]>('SELECT * FROM sessions WHERE id = ?');
  const selectByVisitor = db.query<Row, [string]>(
    `SELECT * FROM sessions WHERE visitor_id = ? AND state IN ('provisioning', 'live')
     ORDER BY created_at DESC LIMIT 1`,
  );
  const count = db.query<{ total: number }, []>(
    `SELECT COUNT(*) AS total FROM sessions WHERE state != 'ended'`,
  );
  const selectOpen = db.query<Row, []>(
    `SELECT * FROM sessions WHERE state != 'ended' ORDER BY created_at`,
  );

  return {
    insert(record) {
      insert.run({
        $id: record.id,
        $visitorId: record.visitorId,
        $deviceId: record.deviceId,
        $state: record.state,
        $createdAt: record.createdAt,
        $expiresAt: record.expiresAt,
        $endReason: record.endReason,
      });
    },
    get(id) {
      const row = select.get(id);
      return row ? toRecord(row) : undefined;
    },
    findActiveByVisitor(visitorId) {
      const row = selectByVisitor.get(visitorId);
      return row ? toRecord(row) : undefined;
    },
    countOpen() {
      return count.get()?.total ?? 0;
    },
    listOpen() {
      return selectOpen.all().map(toRecord);
    },
    update(id, patch) {
      const current = select.get(id);
      if (!current) return;
      db.query(
        `UPDATE sessions
         SET device_id = $deviceId, state = $state, expires_at = $expiresAt, end_reason = $endReason
         WHERE id = $id`,
      ).run({
        $id: id,
        $deviceId: patch.deviceId === undefined ? current.device_id : patch.deviceId,
        $state: patch.state ?? current.state,
        $expiresAt: patch.expiresAt ?? current.expires_at,
        $endReason:
          patch.endReason === undefined ? current.end_reason : patch.endReason,
      });
    },
    close() {
      db.close();
    },
  };
}
