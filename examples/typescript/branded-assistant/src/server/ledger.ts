import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isTerminalStatus, type RunStatus } from '@/shared/contracts';

/**
 * The example's own credit ledger. Mobilerun bills the organization behind the
 * API key; it has no per-end-user accounts, so each end user's budget lives
 * here, in your database.
 *
 * Money flow for one run: reserve → (run) → settle.
 *   reserve: subtract `reserved` from the balance, atomically and only if the
 *            balance covers it;
 *   settle:  charge min(credits used, reserved) and give the rest back.
 */

export type RunRow = {
  id: string;
  user_id: string;
  task_id: string | null;
  device_id: string;
  reserved: number;
  /** Credits charged. NULL until the run settles; settling happens once. */
  settled: number | null;
  status: RunStatus;
  preset_id: string;
  request: string;
  output: string | null;
  message: string | null;
  steps: number | null;
  created_at: string;
};

export type ReserveInput = {
  userId: string;
  runId: string;
  deviceId: string;
  presetId: string;
  request: string;
  amount: number;
};

export type SettleInput = {
  status: RunStatus;
  /** Credits the run actually used; clamped to [0, reserved]. */
  creditsUsed: number;
  output?: Record<string, unknown> | null;
  message?: string | null;
  steps?: number | null;
};

export type Settlement = {
  charged: number;
  refunded: number;
  balance: number;
};

export interface Ledger {
  balance: (userId: string) => number;
  reserve: (input: ReserveInput) => { ok: boolean; balance: number };
  attachTask: (runId: string, taskId: string) => void;
  updateProgress: (
    runId: string,
    progress: { status: RunStatus; steps?: number | null },
  ) => void;
  /** Returns null when the run is unknown or was already settled. */
  settle: (runId: string, input: SettleInput) => Settlement | null;
  getRun: (userId: string, runId: string) => RunRow | undefined;
  getRunById: (runId: string) => RunRow | undefined;
  listRuns: (userId: string, limit: number) => Array<RunRow>;
  openRuns: () => Array<RunRow>;
  close: () => void;
}

export function createLedger(
  path: string,
  startingBalance: number,
): Ledger {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  if (path !== ':memory:') db.run('PRAGMA journal_mode = WAL');
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
      created_at TEXT NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS runs_user_idx ON runs (user_id, created_at)');

  const ensureAccount = db.query(
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
  const insertRun = db.query(
    `INSERT INTO runs
       (id, user_id, device_id, reserved, status, preset_id, request, created_at)
     VALUES (?1, ?2, ?3, ?4, 'starting', ?5, ?6, ?7)`,
  );
  const selectRunById = db.query<RunRow, [string]>(
    'SELECT * FROM runs WHERE id = ?1',
  );
  const selectRun = db.query<RunRow, [string, string]>(
    'SELECT * FROM runs WHERE id = ?1 AND user_id = ?2',
  );
  const selectRuns = db.query<RunRow, [string, number]>(
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
         steps = COALESCE(?6, steps)
     WHERE id = ?1 AND settled IS NULL`,
  );

  const balanceOf = (userId: string): number => {
    ensureAccount.run(userId, startingBalance);
    return readBalance.get(userId)?.balance ?? 0;
  };

  // IMMEDIATE takes the write lock up front, so the check-and-debit is atomic
  // even when several processes share the database file.
  const reserveTx = db.transaction((input: ReserveInput) => {
    ensureAccount.run(input.userId, startingBalance);
    const { changes } = debit.run(input.userId, input.amount);
    if (changes === 0) return { ok: false, balance: balanceOf(input.userId) };
    insertRun.run(
      input.runId,
      input.userId,
      input.deviceId,
      input.amount,
      input.presetId,
      input.request,
      new Date().toISOString(),
    );
    return { ok: true, balance: balanceOf(input.userId) };
  });

  const settleTx = db.transaction(
    (runId: string, input: SettleInput): Settlement | null => {
      const run = selectRunById.get(runId);
      if (!run || run.settled !== null) return null;
      const charged = Math.min(
        Math.max(Math.ceil(input.creditsUsed), 0),
        run.reserved,
      );
      const refunded = run.reserved - charged;
      finishRun.run(
        runId,
        charged,
        input.status,
        input.output ? JSON.stringify(input.output) : null,
        input.message ?? null,
        input.steps ?? null,
      );
      if (refunded > 0) credit.run(run.user_id, refunded);
      return { charged, refunded, balance: balanceOf(run.user_id) };
    },
  );

  return {
    balance: balanceOf,
    reserve: (input) => reserveTx.immediate(input),
    attachTask(runId, taskId) {
      setTask.run(runId, taskId);
    },
    updateProgress(runId, progress) {
      if (isTerminalStatus(progress.status)) return;
      setProgress.run(runId, progress.status, progress.steps ?? null);
    },
    settle: (runId, input) => settleTx.immediate(runId, input),
    getRun: (userId, runId) => selectRun.get(runId, userId) ?? undefined,
    getRunById: (runId) => selectRunById.get(runId) ?? undefined,
    listRuns: (userId, limit) => selectRuns.all(userId, limit),
    openRuns: () => selectOpen.all(),
    close: () => db.close(),
  };
}
