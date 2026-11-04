import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RunStatus, TimelineEntry } from '@/shared/contracts';

/**
 * The example's own credit ledger. Mobilerun bills the organization behind the API key and
 * has no per-end-user accounts, so each user's budget lives here.
 *
 *   reserve: take the reservation from the balance, atomically, only if the balance covers
 *            it and the user has no other active run;
 *   settle:  once per run, charge min(ceil(credits used), reserved) and refund the rest.
 *            Unknown usage charges the whole reservation.
 *
 * SINGLE PROCESS: reserve and settle are atomic in SQLite, but phone locks and the watcher
 * live in one process's memory.
 */
export type RunRecord = {
  id: string; userId: string; taskId: string | null; deviceId: string;
  presetId: string; request: string; status: RunStatus; steps: number | null;
  message: string | null; createdAt: string;
  /** Credits held, and credits charged (null until the run settles). */
  reserved: number; charged: number | null;
  /** The task output as the API returned it (unvalidated), and the timeline saved at settlement. */
  output: unknown; timeline: Array<TimelineEntry> | null;
};
type Reservation = Pick<RunRecord, 'userId' | 'deviceId' | 'presetId' | 'request'> &
  { runId: string; amount: number };
/** `creditsUsed: null` means unknown: the whole reservation is charged. */
export type Settlement = Partial<Pick<RunRecord, 'output' | 'message' | 'steps'>> &
  { status: RunStatus; creditsUsed: number | null; timeline?: Array<TimelineEntry> };
export type Ledger = ReturnType<typeof createLedger>;

type Row = Omit<RunRecord, 'output' | 'timeline'> &
  { output: string | null; timeline: string | null };
const RUN = `SELECT id, user_id AS userId, task_id AS taskId, device_id AS deviceId, reserved,
  settled AS charged, status, preset_id AS presetId, request, output, message, steps,
  timeline, created_at AS createdAt FROM runs`;
const record = (row: Row | null): RunRecord | null =>
  row && { ...row, output: parse(row.output), timeline: parse(row.timeline) };
const parse = (text: string | null) => (text === null ? null : JSON.parse(text));
const json = (value: unknown) => JSON.stringify(value ?? null);

export function createLedger(path: string, startingBalance: number) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run(`CREATE TABLE IF NOT EXISTS accounts (user_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL CHECK (balance >= 0))`);
  db.run(`CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts (user_id), task_id TEXT, device_id TEXT NOT NULL,
    reserved INTEGER NOT NULL, settled INTEGER, status TEXT NOT NULL, preset_id TEXT NOT NULL,
    request TEXT NOT NULL, output TEXT, message TEXT, steps INTEGER, timeline TEXT,
    created_at TEXT NOT NULL)`);
  db.run('CREATE INDEX IF NOT EXISTS runs_user_idx ON runs (user_id, created_at)');
  const sql = db.query.bind(db);

  const byId = sql<Row, [string]>(`${RUN} WHERE id = ?1`);
  const latest = sql<Row, [string]>(
    `${RUN} WHERE user_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  );
  const open = sql<Row, []>(`${RUN} WHERE settled IS NULL ORDER BY created_at`);
  const balance = sql<{ balance: number }, [string]>(
    'SELECT balance FROM accounts WHERE user_id = ?1',
  );
  const active = sql<{ n: number }, [string]>(
    'SELECT COUNT(*) AS n FROM runs WHERE user_id = ?1 AND settled IS NULL',
  );
  const addAccount = sql('INSERT OR IGNORE INTO accounts (user_id, balance) VALUES (?1, ?2)');
  const debit = sql(
    'UPDATE accounts SET balance = balance - ?2 WHERE user_id = ?1 AND balance >= ?2',
  );
  const credit = sql('UPDATE accounts SET balance = balance + ?2 WHERE user_id = ?1');
  const addRun = sql(`INSERT INTO runs (id, user_id, device_id, reserved, status, preset_id,
    request, created_at) VALUES (?1, ?2, ?3, ?4, 'starting', ?5, ?6, ?7)`);
  const setTask = sql('UPDATE runs SET task_id = ?2 WHERE id = ?1');
  const setProgress = sql(`UPDATE runs SET status = ?2, steps = COALESCE(?3, steps)
    WHERE id = ?1 AND settled IS NULL`);
  const finish = sql(`UPDATE runs SET settled = ?2, status = ?3, output = ?4, message = ?5,
    steps = COALESCE(?6, steps), timeline = ?7 WHERE id = ?1 AND settled IS NULL`);

  // The account row appears on the first reservation, never on a read.
  const reserve = db.transaction((r: Reservation): 'ok' | 'insufficient' | 'run_active' => {
    if ((active.get(r.userId)?.n ?? 0) > 0) return 'run_active';
    addAccount.run(r.userId, startingBalance);
    if (debit.run(r.userId, r.amount).changes === 0) return 'insufficient';
    const createdAt = new Date().toISOString();
    addRun.run(r.runId, r.userId, r.deviceId, r.amount, r.presetId, r.request, createdAt);
    return 'ok';
  });

  /** True when this call settled the run. */
  const settle = db.transaction((runId: string, s: Settlement): boolean => {
    const run = byId.get(runId);
    if (!run || run.charged !== null) return false;
    const used = s.creditsUsed === null ? run.reserved : Math.max(Math.ceil(s.creditsUsed), 0);
    const charged = Math.min(used, run.reserved);
    const { status, output, message = null, steps = null, timeline } = s;
    finish.run(runId, charged, status, json(output), message, steps, json(timeline));
    if (charged < run.reserved) credit.run(run.userId, run.reserved - charged);
    return true;
  });

  return {
    /** Unseen users read as the starting budget. */
    balance: (userId: string) => balance.get(userId)?.balance ?? startingBalance,
    // IMMEDIATE takes the write lock up front.
    reserve: (reservation: Reservation) => reserve.immediate(reservation),
    settle: (runId: string, settlement: Settlement) => settle.immediate(runId, settlement),
    attachTask: (runId: string, taskId: string) => void setTask.run(runId, taskId),
    /** Ignored once the run has settled. */
    progress: (runId: string, status: RunStatus, steps?: number) =>
      void setProgress.run(runId, status, steps ?? null),
    run: (runId: string) => record(byId.get(runId)),
    latest: (userId: string) => record(latest.get(userId)),
    open: () => open.all().map((row) => record(row)!),
  };
}
