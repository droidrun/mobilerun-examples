import { describe, expect, test } from 'bun:test';
import { normalizeApiBaseUrl, parseDeviceIds, readServerConfig } from './config';

const SECRET = 'a-session-secret-with-at-least-32-chars';
const DEVICE = '67937442-41bd-4a67-a16e-e1ce86c99568';

describe('server config', () => {
  test('normalizes Mobilerun API URLs to the v1 base', () => {
    expect(normalizeApiBaseUrl('https://api.example.com/')).toBe('https://api.example.com/v1');
    expect(normalizeApiBaseUrl('https://api.mobilerun.ai/v1')).toBe('https://api.mobilerun.ai/v1');
  });

  test('starts with safe local defaults and no API key', () => {
    const config = readServerConfig({});
    expect(config).toMatchObject({
      apiKey: undefined,
      host: '127.0.0.1',
      port: 3_000,
      production: false,
      deviceIds: [],
      startingBudget: 100,
      reservePerRun: 20,
      databasePath: 'data/ledger.sqlite',
      ephemeralSessionSecret: true,
    });
    expect(config.sessionSecret.length).toBeGreaterThanOrEqual(32);
  });

  test('reads the ledger, device and secret settings', () => {
    const config = readServerConfig({
      SESSION_SECRET: SECRET,
      DEVICE_IDS: ` ${DEVICE}, ${DEVICE} `,
      STARTING_BUDGET: '50',
      RESERVE_PER_RUN: '10',
      DATABASE_PATH: '/tmp/ledger.sqlite',
      MOBILERUN_API_KEY: 'dr_sk_test',
    });
    expect(config).toMatchObject({
      sessionSecret: SECRET,
      ephemeralSessionSecret: false,
      deviceIds: [DEVICE],
      startingBudget: 50,
      reservePerRun: 10,
      apiKey: 'dr_sk_test',
    });
  });

  test('requires a stable session secret in production', () => {
    expect(() => readServerConfig({ NODE_ENV: 'production' })).toThrow();
    expect(readServerConfig({ NODE_ENV: 'production', SESSION_SECRET: SECRET }).production).toBe(true);
  });

  test('rejects malformed settings', () => {
    for (const environment of [
      { SESSION_SECRET: 'too-short' },
      { DEVICE_IDS: 'not-a-uuid' },
      { RESERVE_PER_RUN: '0' },
      { STARTING_BUDGET: '-5' },
      { PORT: '70000' },
    ]) {
      expect(() => readServerConfig({ SESSION_SECRET: SECRET, ...environment })).toThrow();
    }
  });

  test('parses a comma list of device ids', () => {
    expect(parseDeviceIds(undefined)).toEqual([]);
    expect(parseDeviceIds('a, b,,a')).toEqual(['a', 'b']);
  });
});
