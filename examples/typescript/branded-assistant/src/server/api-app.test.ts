import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type Mobilerun from '@mobilerun/sdk';
import { createApiApp } from './api-app';
import { createAssistantService } from './assistant-service';
import { createLedger } from './ledger';

const PHONES = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const START = { presetId: 'cheapest-hotel', message: 'Lisbon' };
afterEach(() => mock.restore());

/** The app over a real service, an in-memory ledger and a fake `client.tasks`. */
function setup({ balance = 100, configured = true } = {}) {
  const tasks = {
    run: mock(async (): Promise<{ id: string }> => ({ id: 'task-1' })),
    sendMessage: mock(async () => ({ sent: true })),
  };
  const ledger = createLedger(':memory:', balance);
  const service = createAssistantService({
    client: configured ? ({ tasks } as unknown as Mobilerun) : null,
    ledger,
    deviceIds: PHONES,
    reservePerRun: 20,
    pollIntervalMs: 1_000,
    schedule: () => {},
  });
  const app = createApiApp({ service, sessionSecret: 'test-secret-that-is-at-least-32-chars' });
  return { app, tasks, ledger };
}

/** One browser: keeps its session cookie across requests. */
function browser(app: ReturnType<typeof setup>['app']) {
  let cookie = '';
  return async (path: string, body?: unknown) => {
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    const post = { method: 'POST', body: JSON.stringify(body) };
    const response = await app.request(path, { headers, ...(body === undefined ? {} : post) });
    cookie = response.headers.get('Set-Cookie')?.split(';')[0] ?? cookie;
    return response;
  };
}
const answer = async (response: Response) => [response.status, await response.json()];
const error = (code: string) => expect.objectContaining({ error: code });

describe('session', () => {
  test('a signed HttpOnly cookie; a forged one is replaced; reads create no run', async () => {
    const { app, ledger } = setup();
    const first = await app.request('/api/session');
    const cookie = first.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    const again = await app.request('/api/session', { headers: { Cookie: cookie.split(';')[0]! } });
    expect(again.headers.get('Set-Cookie')).toBeNull();
    const forged = { headers: { Cookie: 'assistant_session=x.forged' } };
    expect((await app.request('/api/session', forged)).headers.get('Set-Cookie')).toContain('assistant_session=');
    expect(ledger.open()).toEqual([]);
  });

  test('without an API key the page loads and starts are refused with JSON', async () => {
    const { app } = setup({ configured: false });
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true, sdkConfigured: false });
    const call = browser(app);
    expect(await (await call('/api/session')).json()).toMatchObject({ balance: 100, run: null });
    expect(await answer(await call('/api/runs', START))).toEqual([503, error('missing_api_key')]);
  });
});

describe('runs', () => {
  test('rejects cross-origin form posts', async () => {
    const { app } = setup();
    const post = (Origin: string) =>
      app.request('/api/runs', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin }, body: '{}' });
    expect((await post('https://evil.example')).status).toBe(403);
    expect((await post('http://localhost')).status).not.toBe(403);
  });

  test('201 on start, 409 run_active, 202 when unconfirmed, 402 when short', async () => {
    const { app, tasks } = setup();
    const call = browser(app);
    expect((await call('/api/runs', START)).status).toBe(201);
    expect(await answer(await call('/api/runs', START))).toEqual([409, error('run_active')]);

    spyOn(console, 'warn').mockImplementation(() => {});
    tasks.run.mockImplementation(() => Promise.reject(new Error('network down')));
    expect((await browser(app)('/api/runs', START)).status).toBe(202);
    expect((await browser(setup({ balance: 0 }).app)('/api/runs', START)).status).toBe(402);
  });

  test('passes API 4xx text on; a 5xx becomes a plain 502, anything else a plain 500', async () => {
    const { app, tasks } = setup();
    spyOn(console, 'error').mockImplementation(() => {});
    const message = 'Device type unavailable';
    const apiError = (status: number) =>
      Object.assign(new Error(String(status)), { status, error: { message } });
    tasks.run.mockImplementation(() => Promise.reject(apiError(422)));
    const rejected = await answer(await browser(app)('/api/runs', START));
    expect(rejected).toEqual([422, { error: 'upstream_rejected', message }]);

    tasks.run.mockImplementation(async () => ({ id: 'task-2' }));
    const call = browser(app);
    const run = (await (await call('/api/runs', START)).json()) as { id: string };
    const note = () => call(`/api/runs/${run.id}/messages`, { message: 'hi' });
    tasks.sendMessage.mockImplementation(() => Promise.reject(apiError(503)));
    expect(await answer(await note())).toEqual([502, error('upstream_error')]);
    tasks.sendMessage.mockImplementation(() => Promise.reject(new TypeError('password is hunter2')));
    const failed = await note();
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('hunter2');
  });

  test('refuses privileged fields and malformed input before any task starts', async () => {
    const { app, tasks } = setup();
    const call = browser(app);
    for (const body of [{ ...START, llmModel: 'x' }, { ...START, message: '  ' }, { message: 'x' }]) {
      expect(await answer(await call('/api/runs', body))).toEqual([400, error('invalid_request')]);
    }
    expect(tasks.run).not.toHaveBeenCalled();
  });

  test("another browser's run is a 404, like an unknown id", async () => {
    const { app, tasks } = setup();
    const owner = browser(app);
    const other = browser(app);
    const run = (await (await owner('/api/runs', START)).json()) as { id: string };
    for (const response of [
      await other(`/api/runs/${run.id}`),
      await other(`/api/runs/${run.id}/messages`, { message: 'hi' }),
      await other(`/api/runs/${run.id}/cancel`, {}),
      await other('/api/runs/not-a-run'),
    ]) {
      expect(await answer(response)).toEqual([404, error('run_not_found')]);
    }
    expect(tasks.sendMessage).not.toHaveBeenCalled();
    expect((await owner(`/api/runs/${run.id}`)).status).toBe(200);
  });
});
