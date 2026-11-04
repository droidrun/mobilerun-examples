import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { createLedger, type Ledger } from './ledger';

function open(startingBalance = 100): { ledger: Ledger; db: Database } {
  const db = new Database(':memory:');
  return { ledger: createLedger(db, startingBalance), db };
}

function reserve(ledger: Ledger, runId: string, userId = 'user-1', amount = 20) {
  return ledger.reserve({
    userId,
    runId,
    deviceId: 'device-1',
    presetId: 'hotel',
    request: 'Lisbon',
    amount,
  });
}

const accounts = (db: Database) =>
  db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM accounts').get()?.n;

describe('credit ledger', () => {
  test('reads never create an account; the first reservation does', () => {
    const { ledger, db } = open(75);
    expect(ledger.balance('user-1')).toBe(75);
    expect(ledger.listRuns('user-1', 10)).toEqual([]);
    expect(accounts(db)).toBe(0);

    expect(reserve(ledger, 'run-1')).toBe('ok');
    expect(accounts(db)).toBe(1);
    expect(ledger.balance('user-1')).toBe(55);
  });

  test('reserve records the run as active', () => {
    const { ledger } = open();
    reserve(ledger, 'run-1');
    expect(ledger.getRun('user-1', 'run-1')).toMatchObject({
      reserved: 20,
      charged: null,
      status: 'starting',
      taskId: null,
    });
  });

  test('refuses a reservation the balance cannot cover and changes nothing', () => {
    const { ledger } = open(10);
    expect(reserve(ledger, 'run-1')).toBe('insufficient');
    expect(ledger.getRun('user-1', 'run-1')).toBeUndefined();
    expect(ledger.balance('user-1')).toBe(10);
  });

  test('a user cannot hold two reservations at once, and may again after settling', () => {
    const { ledger } = open();
    expect(reserve(ledger, 'run-1')).toBe('ok');
    expect(reserve(ledger, 'run-2')).toBe('run_active');
    expect(ledger.balance('user-1')).toBe(80);

    ledger.settle('run-1', { status: 'completed', creditsUsed: 1 });
    expect(reserve(ledger, 'run-2')).toBe('ok');
  });

  test('settle charges credits used, refunds the rest and stores the output', () => {
    const { ledger } = open();
    reserve(ledger, 'run-1');
    expect(
      ledger.settle('run-1', { status: 'completed', creditsUsed: 6.2, output: { a: 1 }, steps: 4 }),
    ).toBe(true);
    expect(ledger.getRun('user-1', 'run-1')).toMatchObject({
      charged: 7,
      status: 'completed',
      output: { a: 1 },
      steps: 4,
    });
    expect(ledger.balance('user-1')).toBe(93);
  });

  test('settle never charges more than was reserved', () => {
    const { ledger } = open();
    reserve(ledger, 'run-1');
    ledger.settle('run-1', { status: 'completed', creditsUsed: 500 });
    expect(ledger.balance('user-1')).toBe(80);
  });

  test('unknown usage charges the whole reservation; explicit zero refunds it', () => {
    const { ledger } = open();
    reserve(ledger, 'run-1');
    ledger.settle('run-1', { status: 'failed', creditsUsed: null });
    expect(ledger.balance('user-1')).toBe(80);

    reserve(ledger, 'run-2');
    ledger.settle('run-2', { status: 'failed', creditsUsed: 0 });
    expect(ledger.balance('user-1')).toBe(80);
  });

  test('settling twice does not refund or charge twice', () => {
    const { ledger } = open();
    reserve(ledger, 'run-1');
    expect(ledger.settle('run-1', { status: 'cancelled', creditsUsed: 5 })).toBe(true);
    expect(ledger.settle('run-1', { status: 'cancelled', creditsUsed: 0 })).toBe(false);
    expect(ledger.balance('user-1')).toBe(95);
  });

  test('progress updates stop once a run is terminal or settled', () => {
    const { ledger } = open();
    reserve(ledger, 'run-1');
    ledger.updateProgress('run-1', { status: 'running', steps: 2 });
    expect(ledger.getRunById('run-1')).toMatchObject({ status: 'running', steps: 2 });
    ledger.updateProgress('run-1', { status: 'completed' });
    expect(ledger.getRunById('run-1')?.status).toBe('running');

    ledger.settle('run-1', { status: 'completed', creditsUsed: 1 });
    ledger.updateProgress('run-1', { status: 'running' });
    expect(ledger.getRunById('run-1')?.status).toBe('completed');
  });

  test('runs are scoped to their user; open runs list only unsettled ones', () => {
    const { ledger } = open();
    reserve(ledger, 'run-1');
    reserve(ledger, 'run-2', 'user-2');
    ledger.settle('run-2', { status: 'completed', creditsUsed: 1 });

    expect(ledger.getRun('user-2', 'run-1')).toBeUndefined();
    expect(ledger.listRuns('user-2', 10).map((run) => run.id)).toEqual(['run-2']);
    expect(ledger.openRuns().map((run) => run.id)).toEqual(['run-1']);
  });
});

describe('ledger timeline', () => {
  test('the final timeline is stored with the settlement and read back', () => {
    const { ledger } = open();
    reserve(ledger, 'run-1');
    expect(ledger.getRunById('run-1')?.timeline).toBeNull();

    const timeline = [{ at: '2026-01-01T00:00:00.000Z', kind: 'status' as const, text: 'Started' }];
    ledger.settle('run-1', { status: 'completed', creditsUsed: 1, timeline });
    expect(ledger.getRunById('run-1')?.timeline).toEqual(timeline);
  });

  test('adds the column to a database created without it', () => {
    const db = new Database(':memory:');
    db.run('CREATE TABLE accounts (user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL)');
    db.run(`CREATE TABLE runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT, device_id TEXT NOT NULL,
      reserved INTEGER NOT NULL, settled INTEGER, status TEXT NOT NULL, preset_id TEXT NOT NULL, request TEXT NOT NULL,
      output TEXT, message TEXT, steps INTEGER, created_at TEXT NOT NULL)`);
    const ledger = createLedger(db, 100);
    reserve(ledger, 'run-1');
    ledger.settle('run-1', { status: 'failed', creditsUsed: 0, timeline: [] });
    expect(ledger.getRunById('run-1')?.timeline).toEqual([]);
  });
});
