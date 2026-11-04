import { describe, expect, spyOn, test } from 'bun:test';
import { createApiApp } from './api-app';
import { FakeApiError, createHarness } from './fake-deps';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';

function setup(options?: Parameters<typeof createHarness>[0]) {
  const harness = createHarness(options);
  const app = createApiApp({
    service: harness.service,
    sessionSecret: SECRET,
    production: false,
  });
  return { app, ...harness };
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
const START = { presetId: 'hotel', message: 'Lisbon' };

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
    expect(response.headers.get('Set-Cookie')).toContain('assistant_session=');
  });

  test('reading the session never creates ledger accounts', async () => {
    const { app, accountCount } = setup();
    for (let visit = 0; visit < 3; visit += 1) {
      expect(((await (await app.request('/api/session')).json()) as { balance: number }).balance).toBe(100);
    }
    expect(accountCount()).toBe(0);
  });

  test('loads without an API key and reports it', async () => {
    const { app } = setup({ withDeps: false });
    const call = browser(app);
    expect(await (await call('/api/session')).json()).toMatchObject({ sdkConfigured: false, balance: 100 });

    const start = await call('/api/runs', post(START));
    expect(start.status).toBe(503);
    expect(await start.json()).toMatchObject({ error: 'missing_api_key' });
  });

  test('keeps prompts, model ids, task ids and stream credentials out of the browser contract', async () => {
    const { app } = setup();
    const call = browser(app);
    await call('/api/runs', post(START));
    const text = await (await call('/api/session')).text();
    for (const secret of ['SECRET-SYSTEM-PROMPT', 'secret/model-id', 'task-1', 'stream', 'instruction']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('csrf', () => {
  test('rejects cross-origin form-style posts and accepts same-origin ones', async () => {
    const { app } = setup();
    const cross = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' },
      body: JSON.stringify(START),
    });
    expect(cross.status).toBe(403);

    const same = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: 'http://localhost' },
      body: JSON.stringify(START),
    });
    expect(same.status).not.toBe(403);
  });
});

describe('runs', () => {
  test('starts, then reads what the watcher settled', async () => {
    const { app, fake, tick } = setup();
    const call = browser(app);

    const started = await call('/api/runs', post(START));
    expect(started.status).toBe(201);
    const run = (await started.json()) as { id: string };

    fake.update('task-1', { status: 'completed', succeeded: true, creditsUsed: 5, output: { hotelName: 'Casa', notes: [] } });
    await tick();
    expect(await (await call(`/api/runs/${run.id}`)).json()).toMatchObject({
      status: 'completed',
      charged: 5,
      balance: 95,
      result: { hotelName: 'Casa', notes: [] },
    });
  });

  test('answers 202 when the start could not be confirmed', async () => {
    const { app, fake } = setup();
    fake.control.startError = new FakeApiError(undefined, 'network down');
    const response = await browser(app)('/api/runs', post(START));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: 'unknown' });
  });

  test('answers 409 for a second active run', async () => {
    const { app } = setup({ deviceIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'] });
    const call = browser(app);
    expect((await call('/api/runs', post(START))).status).toBe(201);
    const second = await call('/api/runs', post(START));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: 'run_active' });
  });

  test('answers 402 JSON when the user is out of credits', async () => {
    const { app } = setup({ startingBalance: 0 });
    const response = await browser(app)('/api/runs', post(START));
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: 'insufficient_credits' });
  });

  test('renders upstream 4xx errors as returned', async () => {
    const { app, fake } = setup();
    fake.control.startError = new FakeApiError(422, 'Device type unavailable');
    const response = await browser(app)('/api/runs', post(START));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'upstream_error', message: 'Device type unavailable' });
  });

  test('rejects privileged fields and malformed input before any task starts', async () => {
    const { app, fake } = setup();
    const call = browser(app);
    for (const body of [
      { ...START, llmModel: 'other/model' },
      { ...START, message: '   ' },
      { message: 'no preset' },
    ]) {
      expect((await call('/api/runs', post(body))).status).toBe(400);
    }
    expect(fake.calls.start).toHaveLength(0);
  });

  test("answers 404 for another browser's run, for notes and cancel too", async () => {
    const { app, fake } = setup();
    const owner = browser(app);
    const other = browser(app);
    const run = (await (await owner('/api/runs', post(START))).json()) as { id: string };

    for (const response of [
      await other(`/api/runs/${run.id}`),
      await other(`/api/runs/${run.id}/messages`, post({ message: 'hi' })),
      await other(`/api/runs/${run.id}/cancel`, post({})),
      await other('/api/runs/not-a-uuid'),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: 'run_not_found' });
    }
    expect(fake.calls.messages).toEqual([]);
    expect(fake.calls.stops).toEqual([]);
    expect((await owner(`/api/runs/${run.id}`)).status).toBe(200);
  });

  test('an undelivered note is an error response', async () => {
    const { app, fake } = setup();
    const call = browser(app);
    const run = (await (await call('/api/runs', post(START))).json()) as { id: string };
    fake.control.messageSent = false;
    const response = await call(`/api/runs/${run.id}/messages`, post({ message: 'hi' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'message_not_sent' });
  });

  test('hides unexpected errors behind a generic 500', async () => {
    const { app, fake } = setup();
    const call = browser(app);
    const run = (await (await call('/api/runs', post(START))).json()) as { id: string };
    const quiet = spyOn(console, 'error').mockImplementation(() => {});
    fake.deps.sendMessage = async () => {
      throw new TypeError('db password is hunter2');
    };
    const response = await call(`/api/runs/${run.id}/messages`, post({ message: 'hi' }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('hunter2');
    quiet.mockRestore();
  });
});
