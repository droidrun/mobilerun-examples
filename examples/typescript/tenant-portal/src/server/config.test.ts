import { describe, expect, test } from 'bun:test';
import {
  DEV_SESSION_SECRET,
  normalizeApiBaseUrl,
  parseEmailList,
  readServerConfig,
} from './config';

const SECRET = 'a'.repeat(32);

describe('server config', () => {
  test('normalizes Mobilerun API URLs to the v1 base', () => {
    expect(normalizeApiBaseUrl('https://api.example.com/')).toBe(
      'https://api.example.com/v1',
    );
    expect(normalizeApiBaseUrl('https://api.mobilerun.ai/v1')).toBe(
      'https://api.mobilerun.ai/v1',
    );
  });

  test('uses safe local defaults without requiring an API key', () => {
    expect(readServerConfig({ SESSION_SECRET: SECRET })).toEqual({
      apiKey: undefined,
      apiUrl: undefined,
      host: '127.0.0.1',
      port: 3_000,
      production: false,
      sessionSecret: SECRET,
      databasePath: './data/portal.sqlite',
      maxDevicesPerUser: 1,
      adminEmails: [],
    });
  });

  test('rejects a missing or short session secret', () => {
    expect(() => readServerConfig({})).toThrow(/SESSION_SECRET/);
    expect(() => readServerConfig({ SESSION_SECRET: 'too-short' })).toThrow(
      /at least 32/,
    );
  });

  test('refuses the development secret in production', () => {
    const environment = { SESSION_SECRET: DEV_SESSION_SECRET };
    expect(readServerConfig(environment).production).toBe(false);
    expect(() =>
      readServerConfig({ ...environment, NODE_ENV: 'production' }),
    ).toThrow(/development SESSION_SECRET/);
  });

  test('validates the device quota', () => {
    expect(
      readServerConfig({ SESSION_SECRET: SECRET, MAX_DEVICES_PER_USER: '0' })
        .maxDevicesPerUser,
    ).toBe(0);
    expect(() =>
      readServerConfig({ SESSION_SECRET: SECRET, MAX_DEVICES_PER_USER: '2' }),
    ).toThrow();
  });

  test('parses the admin email list', () => {
    expect(parseEmailList(' Admin@Example.com, ops@example.com ,')).toEqual([
      'admin@example.com',
      'ops@example.com',
    ]);
    expect(parseEmailList(undefined)).toEqual([]);
  });
});
