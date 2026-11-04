import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createApiApp } from './api-app';
import { createHarness, type Harness } from './fake-deps';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';

let harness: Harness | undefined;

function setup(options?: Parameters<typeof createHarness>[0]) {
  harness = createHarness(options);
  const app = createApiApp({
    service: harness.service,
    sessionSecret: SECRET,
    production: false,
  });
  return { app, fake: harness.fake };
}

/** A tiny cookie jar so one "browser" keeps its identity across requests. */
function browser(app: ReturnType<typeof setup>['app']) {
  let cookie = '';
  return async (path: string, init: RequestInit = {}) => {
    const response = await app.request(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...init.headers },
    });
    const set = response.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0] ?? '';
    return response;
  };
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

describe('session', () => {
  test('hands out a signed HttpOnly cookie and a stable identity', async () => {
    const { app } = setup();
    const first = await app.request('/api/session');
    const cookie = first.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('assistant_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    const again = await app.request('/api/session', { headers: { Cookie: cookie.split(';')[0] ?? '' } });
    expect(again.headers.get('Set-Cookie')).toBeNull();
  });

  test('replaces a forged cookie instead of trusting it', async () => {
    const { app } = setup();
    const response = await app.request('/api/session', {
      headers: { Cookie: 'assistant_session=someone-else.forgedsignature' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('assistant_session=');
  });

  test('loads without an API key and reports it', async () => {
    const { app } = setup({ withDeps: false });
    const call = browser(app);
    const session = (await (await call('/api/session')).json()) as Record<string, unknown>;
    expect(session).toMatchObject({ sdkConfigured: false, balance: 100 });

    const start = await call('/api/runs', post({ presetId: 'hotel', message: 'Lisbon' }));
    expect(start.status).toBe(503);
    expect(await start.json()).toMatchObject({ error: 'missing_api_key' });
  });

  test('keeps prompts, model ids and the API key out of the browser contract', async () => {
    const { app } = setup();
    const call = browser(app);
    await call('/api/runs', post({ presetId: 'hotel', message: 'Lisbon' }));
    const text = await (await call('/api/session')).text();
    expect(text).not.toContain('SECRET-SYSTEM-PROMPT');
    expect(text).not.toContain('secret/model-id');
    expect(text).not.toContain('task-1');
    expect(text).not.toContain('instruction');
  });
});

describe('runs', () => {
  test('starts, polls and settles a run end to end', async () => {
    const { app, fake } = setup();
    const call = browser(app);

    const started = await call('/api/runs', post({ presetId: 'hotel', message: 'Lisbon' }));
    expect(started.status).toBe(201);
    const run = (await started.json()) as { id: string; balance: number };
    expect(run.balance).toBe(80);

    fake.update('task-1', { status: 'completed', succeeded: true, creditsUsed: 5, output: { hotelName: 'Casa' } });
    const done = await call(`/api/runs/${run.id}`);
    expect(await done.json()).toMatchObject({ status: 'completed', charged: 5, balance: 95 });
  });

  test('answers 402 JSON when the user is out of credits', async () => {
    const { app } = setup({ startingBalance: 0 });
    const response = await browser(app)('/api/runs', post({ presetId: 'hotel', message: 'Lisbon' }));
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: 'insufficient_credits' });
  });

  test('renders upstream 4xx errors as returned', async () => {
    const { app, fake } = setup();
    const { UpstreamError } = await import('./errors');
    fake.control.startError = new UpstreamError(422, 'Device type unavailable');
    const response = await browser(app)('/api/runs', post({ presetId: 'hotel', message: 'Lisbon' }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'upstream_error',
      message: 'Device type unavailable',
    });
  });

  test('rejects privileged fields and malformed input before any task starts', async () => {
    const { app, fake } = setup();
    const call = browser(app);
    for (const body of [
      { presetId: 'hotel', message: 'x', llmModel: 'other/model' },
      { presetId: 'hotel', message: '   ' },
      { message: 'no preset' },
    ]) {
      expect((await call('/api/runs', post(body))).status).toBe(400);
    }
    expect(fake.calls.start).toHaveLength(0);
  });

  test("answers 404 for another browser's run, for messages and cancel too", async () => {
    const { app, fake } = setup();
    const owner = browser(app);
    const other = browser(app);
    const run = (await (await owner('/api/runs', post({ presetId: 'hotel', message: 'Lisbon' }))).json()) as {
      id: string;
    };

    for (const response of [
      await other(`/api/runs/${run.id}`),
      await other(`/api/runs/${run.id}/messages`, post({ message: 'hi' })),
      await other(`/api/runs/${run.id}/cancel`, { method: 'POST' }),
      await other('/api/runs/not-a-uuid'),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: 'run_not_found' });
    }
    expect(fake.calls.messages).toEqual([]);
    expect(fake.calls.stops).toEqual([]);
    expect((await owner(`/api/runs/${run.id}`)).status).toBe(200);
  });

  test('hides unexpected errors behind a generic 500', async () => {
    const { app, fake } = setup();
    const quiet = spyOn(console, 'error').mockImplementation(() => {});
    fake.deps.startTask = async () => {
      throw new Error('db password is hunter2');
    };
    const response = await browser(app)('/api/runs', post({ presetId: 'hotel', message: 'Lisbon' }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('hunter2');
    quiet.mockRestore();
  });
});
