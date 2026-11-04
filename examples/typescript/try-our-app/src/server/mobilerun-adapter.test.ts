import { describe, expect, test } from 'bun:test';
import type Mobilerun from '@mobilerun/sdk';
import { createMobilerunDeviceDeps } from './mobilerun-adapter';

function clientWithKiosk(enable: (...args: Array<unknown>) => Promise<void>) {
  return { devices: { kiosk: { enable } } } as unknown as Mobilerun;
}

const noTask = () =>
  new Error('500 kiosk: no task found for package com.android.chrome');

describe('kiosk enable', () => {
  test('retries while the app has no task yet, one second apart', async () => {
    const options: Array<unknown> = [];
    let calls = 0;
    const delays: Array<number> = [];
    const deps = createMobilerunDeviceDeps(
      clientWithKiosk(async (_id, _params, requestOptions) => {
        options.push(requestOptions);
        calls += 1;
        if (calls < 3) throw noTask();
      }),
      { sleep: async (ms) => void delays.push(ms) },
    );

    await deps.enableKiosk('device-1', 'com.android.chrome');

    expect(calls).toBe(3);
    expect(delays).toEqual([1_000, 1_000]);
    // The SDK's own retries are off so this loop is the only one.
    expect(options).toEqual(Array(3).fill({ maxRetries: 0 }));
  });

  test('fails after five retries while no task shows up', async () => {
    let calls = 0;
    const deps = createMobilerunDeviceDeps(
      clientWithKiosk(async () => {
        calls += 1;
        throw noTask();
      }),
      { sleep: async () => {} },
    );

    await expect(deps.enableKiosk('device-1', 'com.android.chrome')).rejects.toThrow(
      'no task found',
    );
    expect(calls).toBe(6);
  });

  test('does not retry any other error', async () => {
    let calls = 0;
    const deps = createMobilerunDeviceDeps(
      clientWithKiosk(async () => {
        calls += 1;
        throw new Error('403 forbidden');
      }),
      { sleep: async () => {} },
    );

    await expect(deps.enableKiosk('device-1', 'com.android.chrome')).rejects.toThrow(
      'forbidden',
    );
    expect(calls).toBe(1);
  });
});
