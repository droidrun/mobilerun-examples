import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** `ending`: a terminate is owed. The row stays open, keeping its slot, until the phone is gone. */
export type SessionState = 'provisioning' | 'live' | 'ending' | 'ended';
export type SessionRecord = {
  id: string;
  visitorId: string;
  deviceId: string | null;
  state: SessionState;
  expiresAt: number;
};
type Patch = Partial<Pick<SessionRecord, 'deviceId' | 'state' | 'expiresAt'>>;
export type SessionStore = ReturnType<typeof createSessionStore>;

/** Sessions live in SQLite so a restarted server still knows which phones it owes a terminate. */
export function createSessionStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, visitorId TEXT NOT NULL,
    deviceId TEXT, state TEXT NOT NULL, expiresAt INTEGER NOT NULL)`);
  const select = (where: string) =>
    db.query<SessionRecord, Array<string>>(`SELECT * FROM sessions WHERE ${where}`);
  const byId = select('id = ?');
  const open = select(`state != 'ended' ORDER BY rowid`);
  const active = select(`visitorId = ? AND state IN ('provisioning', 'live') ORDER BY rowid DESC`);
  const insert = db.query(`INSERT INTO sessions VALUES ($id, $visitorId, $deviceId, $state,
    $expiresAt)`);
  const update = db.query(`UPDATE sessions SET deviceId = $deviceId, state = $state,
    expiresAt = $expiresAt WHERE id = $id`);

  return {
    get: (id: string) => byId.get(id) ?? undefined,
    open: () => open.all(),
    /** The visitor's newest session that is booting or running. */
    activeFor: (visitorId: string) => active.get(visitorId) ?? undefined,
    insert: (record: SessionRecord) => void insert.run(record),
    update(id: string, patch: Patch) {
      const row = byId.get(id);
      if (!row) return;
      const { deviceId, state, expiresAt } = { ...row, ...patch };
      update.run({ id, deviceId, state, expiresAt });
    },
    close: () => db.close(),
  };
}
