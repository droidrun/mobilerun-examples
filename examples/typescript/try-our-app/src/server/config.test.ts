import { describe, expect, test } from 'bun:test';
import { parseBrand } from './brand';
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
      reaperIntervalMs: 15_000,
      provisionTimeoutMs: 120_000,
      maxConcurrentSessions: 3,
      rateLimitMax: 3,
      rateLimitWindowMs: 3_600_000,
      cookieSecret: undefined,
      sessionsDbPath: 'data/sessions.sqlite',
      brandFile: 'brand.json',
    });
  });

  test('reads limits from the environment and ignores empty values', () => {
    const config = readServerConfig({
      DEMO_APP_PACKAGE: 'com.example.shop',
      SESSION_TTL_SECONDS: '120',
      REAPER_INTERVAL_SECONDS: '5',
      MAX_CONCURRENT_SESSIONS: '10',
      RATE_LIMIT_MAX: '1',
      RATE_LIMIT_WINDOW_SECONDS: '60',
      MOBILERUN_CLOUD_API_KEY: '',
    });

    expect(config).toMatchObject({
      apiKey: undefined,
      appPackage: 'com.example.shop',
      sessionTtlMs: 120_000,
      reaperIntervalMs: 5_000,
      maxConcurrentSessions: 10,
      rateLimitMax: 1,
      rateLimitWindowMs: 60_000,
    });
  });

  test('rejects invalid values', () => {
    expect(() => readServerConfig({ DEMO_APP_PACKAGE: 'not a package' })).toThrow();
    expect(() => readServerConfig({ SESSION_TTL_SECONDS: '0' })).toThrow();
    expect(() => readServerConfig({ MAX_CONCURRENT_SESSIONS: '-1' })).toThrow();
    expect(() => readServerConfig({ PORT: '99999' })).toThrow();
    expect(() => readServerConfig({ COOKIE_SECRET: 'short' })).toThrow();
  });
});

describe('brand file', () => {
  test('accepts the bundled brand and rejects unsafe colors', async () => {
    const source = await Bun.file('brand.json').text();
    expect(parseBrand(source).name).toBe('Fernly');

    const unsafe = JSON.parse(source) as { colors: Record<string, string> };
    unsafe.colors.primary = 'red; background: url(x)';
    expect(() => parseBrand(JSON.stringify(unsafe))).toThrow();
  });
});
