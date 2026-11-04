import { afterEach, describe, expect, test } from 'bun:test';
import { createLedger, type Ledger } from './ledger';

let ledger: Ledger | undefined;

function open(startingBalance = 100): Ledger {
  ledger = createLedger(':memory:', startingBalance);
  return ledger;
}

function reserve(target: Ledger, runId: string, amount = 20, userId = 'user-1') {
  return target.reserve({
    userId,
    runId,
    deviceId: 'device-1',
    presetId: 'hotel',
    request: 'Lisbon',
    amount,
  });
}

afterEach(() => {
  ledger?.close();
  ledger = undefined;
});

describe('credit ledger', () => {
  test('creates an account with the starting budget on first use', () => {
    expect(open(75).balance('user-1')).toBe(75);
  });

  test('reserve debits the balance and records the run', () => {
    const target = open();
    expect(reserve(target, 'run-1')).toEqual({ ok: true, balance: 80 });
    expect(target.getRun('user-1', 'run-1')).toMatchObject({
      reserved: 20,
      settled: null,
      status: 'starting',
    });
  });

  test('refuses a reservation the balance cannot cover and changes nothing', () => {
    const target = open(10);
    expect(reserve(target, 'run-1')).toEqual({ ok: false, balance: 10 });
    expect(target.getRun('user-1', 'run-1')).toBeUndefined();
    expect(target.balance('user-1')).toBe(10);
  });

  test('two reservations against a balance for one cannot both succeed', () => {
    const target = open(30);
    const results = [reserve(target, 'run-1'), reserve(target, 'run-2')];
    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect(target.balance('user-1')).toBe(10);
  });

  test('settle charges credits used and refunds the rest', () => {
    const target = open();
    reserve(target, 'run-1');
    expect(
      target.settle('run-1', { status: 'completed', creditsUsed: 7, output: { a: 1 } }),
    ).toEqual({ charged: 7, refunded: 13, balance: 93 });
    expect(target.getRun('user-1', 'run-1')).toMatchObject({
      settled: 7,
      status: 'completed',
      output: '{"a":1}',
    });
  });

  test('settle never charges more than was reserved', () => {
    const target = open();
    reserve(target, 'run-1');
    expect(target.settle('run-1', { status: 'completed', creditsUsed: 500 })).toEqual({
      charged: 20,
      refunded: 0,
      balance: 80,
    });
  });

  test('a failed run with no usage is refunded in full', () => {
    const target = open();
    reserve(target, 'run-1');
    expect(target.settle('run-1', { status: 'failed', creditsUsed: 0 })).toMatchObject({
      charged: 0,
      refunded: 20,
      balance: 100,
    });
  });

  test('settling twice does not refund twice', () => {
    const target = open();
    reserve(target, 'run-1');
    target.settle('run-1', { status: 'cancelled', creditsUsed: 5 });
    expect(target.settle('run-1', { status: 'cancelled', creditsUsed: 0 })).toBeNull();
    expect(target.balance('user-1')).toBe(95);
  });

  test('runs are scoped to their user', () => {
    const target = open();
    reserve(target, 'run-1');
    expect(target.getRun('user-2', 'run-1')).toBeUndefined();
    expect(target.listRuns('user-2', 10)).toEqual([]);
  });
});
