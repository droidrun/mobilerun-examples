import { describe, expect, test } from 'bun:test';
import { normalizeApiBaseUrl, readServerConfig } from './config';

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
    expect(readServerConfig({})).toEqual({
      apiKey: undefined,
      apiUrl: undefined,
      host: '127.0.0.1',
      port: 3_000,
      production: false,
      appPackage: 'com.android.chrome',
      sessionTtlMs: 300_000,
      maxConcurrentSessions: 3,
      rateLimitMax: 3,
    });
  });

  test('reads limits from the environment and ignores empty values', () => {
    const config = readServerConfig({
      DEMO_APP_PACKAGE: 'com.example.shop',
      SESSION_TTL_SECONDS: '120',
      MAX_CONCURRENT_SESSIONS: '10',
      RATE_LIMIT_MAX: '1',
      MOBILERUN_CLOUD_API_KEY: '',
    });

    expect(config).toMatchObject({
      apiKey: undefined,
      appPackage: 'com.example.shop',
      sessionTtlMs: 120_000,
      maxConcurrentSessions: 10,
      rateLimitMax: 1,
    });
  });

  test('rejects invalid values', () => {
    expect(() => readServerConfig({ DEMO_APP_PACKAGE: 'not a package' })).toThrow();
    expect(() => readServerConfig({ SESSION_TTL_SECONDS: '0' })).toThrow();
    expect(() => readServerConfig({ MAX_CONCURRENT_SESSIONS: '-1' })).toThrow();
    expect(() => readServerConfig({ PORT: '99999' })).toThrow();
  });
});
