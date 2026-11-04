import { expect, test } from 'bun:test';
import { readServerConfig } from './config';

const SECRET = 'a'.repeat(32);

test('local defaults need no API key and make a random session secret per process', () => {
  const first = readServerConfig({});
  expect(first).toMatchObject({
    apiKey: undefined,
    baseURL: undefined,
    port: 3_000,
    databasePath: './data/portal.sqlite',
    production: false,
    sessionSecretGenerated: true,
  });
  expect(first.sessionSecret).toMatch(/^[0-9a-f]{64}$/);
  // An empty line, as in .env.example, counts as unset.
  expect(readServerConfig({ SESSION_SECRET: '' }).sessionSecret).not.toBe(first.sessionSecret);
});

test('a set secret must be long enough, and production requires one', () => {
  expect(() => readServerConfig({ SESSION_SECRET: 'too-short' })).toThrow(/at least 32/);
  expect(() => readServerConfig({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET is required/);
  const config = readServerConfig({ NODE_ENV: 'production', SESSION_SECRET: SECRET });
  expect(config).toMatchObject({ sessionSecret: SECRET, sessionSecretGenerated: false });
});

test('the API URL gets its /v1 suffix when missing', () => {
  const url = (value: string) => readServerConfig({ MOBILERUN_API_URL: value }).baseURL;
  expect(url('https://api.example.com/')).toBe('https://api.example.com/v1');
  expect(url('https://api.mobilerun.ai/v1')).toBe('https://api.mobilerun.ai/v1');
});
