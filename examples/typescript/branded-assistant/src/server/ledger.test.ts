import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { createLedger, type Ledger } from './ledger';

const reserve = (ledger: Ledger, runId: string, userId = 'user-1') =>
  ledger.reserve({ userId, runId, deviceId: 'phone-1', presetId: 'p', request: 'r', amount: 20 });

describe('credit ledger', () => {
  test('a read never creates an account; the first reservation does', () => {
    const path = `${tmpdir()}/ledger-${crypto.randomUUID()}.sqlite`;
    const ledger = createLedger(path, 75);
    const accounts = () => new Database(path).query('SELECT * FROM accounts').all().length;
    expect(ledger.balance('user-1')).toBe(75);
    expect(ledger.latest('user-1')).toBeNull();
    expect(accounts()).toBe(0);
    expect(reserve(ledger, 'run-1')).toBe('ok');
    expect(accounts()).toBe(1);
    expect(ledger.balance('user-1')).toBe(55);
    expect(ledger.run('run-1')).toMatchObject({ reserved: 20, charged: null, status: 'starting' });
  });

  test('refuses what the balance cannot cover, and a second active run', () => {
    const poor = createLedger(':memory:', 10);
    expect(reserve(poor, 'run-1')).toBe('insufficient');
    expect(poor.run('run-1')).toBeNull();
    expect(poor.balance('user-1')).toBe(10);

    const ledger = createLedger(':memory:', 100);
    expect(reserve(ledger, 'run-1')).toBe('ok');
    expect(reserve(ledger, 'run-2')).toBe('run_active');
    ledger.settle('run-1', { status: 'completed', creditsUsed: 1 });
    expect(reserve(ledger, 'run-2')).toBe('ok');
  });

  test('settles once: charges ceil(used) capped at the reservation, refunds the rest', () => {
    const ledger = createLedger(':memory:', 100);
    reserve(ledger, 'run-1');
    const timeline = [{ at: '2026-01-01T00:00:00.000Z', kind: 'status' as const, text: 'Started' }];
    const done = { status: 'completed' as const, output: { a: 1 }, steps: 4, timeline };
    expect(ledger.settle('run-1', { ...done, creditsUsed: 6.2 })).toBe(true);
    expect(ledger.settle('run-1', { status: 'failed', creditsUsed: 0 })).toBe(false);
    expect(ledger.run('run-1')).toMatchObject({ ...done, charged: 7 });
    expect(ledger.balance('user-1')).toBe(93);

    reserve(ledger, 'run-2');
    ledger.settle('run-2', { status: 'completed', creditsUsed: 500 });
    expect(ledger.balance('user-1')).toBe(73);
  });

  test('unknown usage charges the whole reservation; an explicit zero refunds it', () => {
    const ledger = createLedger(':memory:', 100);
    reserve(ledger, 'run-1');
    ledger.settle('run-1', { status: 'cancelled', creditsUsed: null });
    expect(ledger.balance('user-1')).toBe(80);
    reserve(ledger, 'run-2');
    ledger.settle('run-2', { status: 'failed', creditsUsed: 0 });
    expect(ledger.balance('user-1')).toBe(80);
  });

  test('progress stops at settlement; open runs are the unsettled ones', () => {
    const ledger = createLedger(':memory:', 100);
    reserve(ledger, 'run-1');
    reserve(ledger, 'run-2', 'user-2');
    ledger.progress('run-1', 'running', 2);
    expect(ledger.run('run-1')).toMatchObject({ status: 'running', steps: 2 });
    ledger.settle('run-1', { status: 'completed', creditsUsed: 1 });
    ledger.progress('run-1', 'running');
    expect(ledger.run('run-1')?.status).toBe('completed');
    expect(ledger.open().map((run) => run.id)).toEqual(['run-2']);
  });
});
