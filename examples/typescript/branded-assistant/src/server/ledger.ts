import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isTerminalStatus, type RunStatus, type TimelineEntry } from '@/shared/contracts';

/**
 * The example's own credit ledger. Mobilerun bills the organization behind the
 * API key; it has no per-end-user accounts, so each end user's budget lives
 * here, in your database.
 *
 * SINGLE PROCESS. Reserve and settle are atomic in SQLite, but the rest of the
 * server (phone locks, the watcher) lives in one process's memory. Run one
 * instance, or move all of it into a shared store first.
 *
 * Money flow for one run: reserve → (run) → settle.
 *   reserve: subtract the reservation from the balance, atomically and only if
 *            the balance covers it and the user has no other active run;
 *   settle:  charge min(credits used, reserved) and give the rest back. When
 *            the usage is unknown, the whole reservation is charged.
 */

export type RunRecord = {
  id: string;
  userId: string;
  taskId: string | null;
  deviceId: string;
  reserved: number;
  /** Credits charged (the `settled` column). null until the run settles. */
  charged: number | null;
  status: RunStatus;
  presetId: string;
  request: string;
  /** The task output as returned by the API; unvalidated. */
  output: unknown;
  message: string | null;
  steps: number | null;
  /** The final timeline, saved when the run settles; null while active. */
  timeline: Array<TimelineEntry> | null;
  createdAt: string;
};

export type ReserveInput = {
  userId: string;
  runId: string;
  deviceId: string;
  presetId: string;
  request: string;
  amount: number;
};

export type ReserveOutcome = 'ok' | 'insufficient' | 'run_active';

export type SettleInput = {
  status: RunStatus;
  /** Credits used, or null when unknown (charges the whole reservation). */
  creditsUsed: number | null;
  output?: unknown;
  message?: string | null;
  steps?: number | null;
  timeline?: Array<TimelineEntry>;
};

export interface Ledger {
  /** Never creates an account: unseen users read as the starting budget. */
  balance: (userId: string) => number;
  reserve: (input: ReserveInput) => ReserveOutcome;
  attachTask: (runId: string, taskId: string) => void;
  /** Progress for a run that is still active; ignored for terminal statuses. */
  updateProgress: (
    runId: string,
    progress: { status: RunStatus; steps?: number | null },
  ) => void;
  /** True when this call settled the run; false when it was unknown or already settled. */
  settle: (runId: string, input: SettleInput) => boolean;
  getRun: (userId: string, runId: string) => RunRecord | undefined;
  getRunById: (runId: string) => RunRecord | undefined;
  listRuns: (userId: string, limit: number) => Array<RunRecord>;
  openRuns: () => Array<RunRecord>;
}

type RunRow = {
  id: string;
  user_id: string;
  task_id: string | null;
  device_id: string;
  reserved: number;
  settled: number | null;
  status: RunStatus;
  preset_id: string;
  request: string;
  output: string | null;
  message: string | null;
  steps: number | null;
  timeline: string | null;
  created_at: string;
};

function toRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    deviceId: row.device_id,
    reserved: row.reserved,
    charged: row.settled,
    status: row.status,
    presetId: row.preset_id,
    request: row.request,
    output: row.output === null ? null : (JSON.parse(row.output) as unknown),
    message: row.message,
    steps: row.steps,
    timeline: row.timeline === null ? null : (JSON.parse(row.timeline) as Array<TimelineEntry>),
    createdAt: row.created_at,
  };
}

export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  if (path !== ':memory:') db.run('PRAGMA journal_mode = WAL');
  return db;
}

export function createLedger(db: Database, startingBalance: number): Ledger {
  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      user_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL CHECK (balance >= 0)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES accounts (user_id),
      task_id TEXT,
      device_id TEXT NOT NULL,
      reserved INTEGER NOT NULL,
      settled INTEGER,
      status TEXT NOT NULL,
      preset_id TEXT NOT NULL,
      request TEXT NOT NULL,
      output TEXT,
      message TEXT,
      steps INTEGER,
      timeline TEXT,
      created_at TEXT NOT NULL
    )
  `);
  // Databases created before the timeline column existed.
  const columns = db.query<{ name: string }, []>('PRAGMA table_info(runs)').all();
  if (!columns.some((column) => column.name === 'timeline')) {
    db.run('ALTER TABLE runs ADD COLUMN timeline TEXT');
  }
  db.run('CREATE INDEX IF NOT EXISTS runs_user_idx ON runs (user_id, created_at)');

  const insertAccount = db.query(
    'INSERT OR IGNORE INTO accounts (user_id, balance) VALUES (?1, ?2)',
  );
  const readBalance = db.query<{ balance: number }, [string]>(
    'SELECT balance FROM accounts WHERE user_id = ?1',
  );
  const debit = db.query(
    'UPDATE accounts SET balance = balance - ?2 WHERE user_id = ?1 AND balance >= ?2',
  );
  const credit = db.query(
    'UPDATE accounts SET balance = balance + ?2 WHERE user_id = ?1',
  );
  const countOpen = db.query<{ open: number }, [string]>(
    'SELECT COUNT(*) AS open FROM runs WHERE user_id = ?1 AND settled IS NULL',
  );
  const insertRun = db.query(
    `INSERT INTO runs
       (id, user_id, device_id, reserved, status, preset_id, request, created_at)
     VALUES (?1, ?2, ?3, ?4, 'starting', ?5, ?6, ?7)`,
  );
  const selectById = db.query<RunRow, [string]>('SELECT * FROM runs WHERE id = ?1');
  const selectOwned = db.query<RunRow, [string, string]>(
    'SELECT * FROM runs WHERE id = ?1 AND user_id = ?2',
  );
  const selectRecent = db.query<RunRow, [string, number]>(
    'SELECT * FROM runs WHERE user_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2',
  );
  const selectOpen = db.query<RunRow, []>(
    'SELECT * FROM runs WHERE settled IS NULL ORDER BY created_at',
  );
  const setTask = db.query('UPDATE runs SET task_id = ?2 WHERE id = ?1');
  const setProgress = db.query(
    `UPDATE runs SET status = ?2, steps = COALESCE(?3, steps)
     WHERE id = ?1 AND settled IS NULL`,
  );
  const finishRun = db.query(
    `UPDATE runs
     SET settled = ?2, status = ?3, output = ?4, message = ?5,
         steps = COALESCE(?6, steps), timeline = ?7
     WHERE id = ?1 AND settled IS NULL`,
  );

  const balanceOf = (userId: string): number =>
    readBalance.get(userId)?.balance ?? startingBalance;

  // The account row appears on the first reservation, never on a read.
  const reserveTx = db.transaction((input: ReserveInput): ReserveOutcome => {
    if ((countOpen.get(input.userId)?.open ?? 0) > 0) return 'run_active';
    insertAccount.run(input.userId, startingBalance);
    if (debit.run(input.userId, input.amount).changes === 0) return 'insufficient';
    insertRun.run(
      input.runId,
      input.userId,
      input.deviceId,
      input.amount,
      input.presetId,
      input.request,
      new Date().toISOString(),
    );
    return 'ok';
  });

  const settleTx = db.transaction((runId: string, input: SettleInput): boolean => {
    const run = selectById.get(runId);
    if (!run || run.settled !== null) return false;
    const charged =
      input.creditsUsed === null
        ? run.reserved
        : Math.min(Math.max(Math.ceil(input.creditsUsed), 0), run.reserved);
    finishRun.run(
      runId,
      charged,
      input.status,
      input.output === undefined || input.output === null
        ? null
        : JSON.stringify(input.output),
      input.message ?? null,
      input.steps ?? null,
      input.timeline ? JSON.stringify(input.timeline) : null,
    );
    if (charged < run.reserved) credit.run(run.user_id, run.reserved - charged);
    return true;
  });

  const record = (row: RunRow | null): RunRecord | undefined =>
    row ? toRecord(row) : undefined;

  return {
    balance: balanceOf,
    // IMMEDIATE takes the write lock up front.
    reserve: (input) => reserveTx.immediate(input),
    attachTask(runId, taskId) {
      setTask.run(runId, taskId);
    },
    updateProgress(runId, progress) {
      if (isTerminalStatus(progress.status)) return;
      setProgress.run(runId, progress.status, progress.steps ?? null);
    },
    settle: (runId, input) => settleTx.immediate(runId, input),
    getRun: (userId, runId) => record(selectOwned.get(runId, userId)),
    getRunById: (runId) => record(selectById.get(runId)),
    listRuns: (userId, limit) => selectRecent.all(userId, limit).map(toRecord),
    openRuns: () => selectOpen.all().map(toRecord),
  };
}
