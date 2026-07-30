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
    });
  });
});
