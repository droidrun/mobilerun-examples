import { describe, expect, test } from 'bun:test';
import { normalizeApiBaseUrl, readServerConfig } from './config';

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
      sessionSecretGenerated: false,
      databasePath: './data/portal.sqlite',
    });
  });

  test('rejects a short session secret', () => {
    expect(() => readServerConfig({ SESSION_SECRET: 'too-short' })).toThrow(
      /at least 32/,
    );
  });

  test('generates a random per-process secret outside production', () => {
    const first = readServerConfig({});
    const second = readServerConfig({ SESSION_SECRET: '' });

    expect(first.sessionSecretGenerated).toBe(true);
    expect(first.sessionSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(second.sessionSecret).not.toBe(first.sessionSecret);
  });

  test('requires a session secret in production', () => {
    expect(() => readServerConfig({ NODE_ENV: 'production' })).toThrow(
      /SESSION_SECRET is required/,
    );
    expect(
      readServerConfig({ NODE_ENV: 'production', SESSION_SECRET: SECRET })
        .sessionSecret,
    ).toBe(SECRET);
  });

  test('reads the API key and URL', () => {
    const config = readServerConfig({
      SESSION_SECRET: SECRET,
      MOBILERUN_CLOUD_API_KEY: 'dr_sk_test',
      MOBILERUN_API_URL: 'https://api.example.com',
    });
    expect(config.apiKey).toBe('dr_sk_test');
    expect(config.apiUrl).toBe('https://api.example.com/v1');
  });
});
