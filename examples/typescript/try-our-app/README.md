# Try our app: a white-label live demo

New to the API? Read the [task runner](../task-runner/) example first.

A fictional company, **Fernly**, puts a "Start demo" button on its website. A
visitor clicks it, gets a disposable Android cloud phone locked to the Fernly
app (kiosk mode), uses it in the browser for a few minutes, and the phone is
terminated afterwards. The visitor never sees Mobilerun.

```text
browser ──same-origin HTTP──▶ Bun + Hono ──@mobilerun/sdk──▶ Mobilerun API
   │                              └── SQLite: which session owns which phone
   └──@mobilerun/react + short-lived stream token──────────▶ phone stream
```

## What it demonstrates

- one phone per visitor: `devices.create` → `devices.waitReady` →
  `devices.apps.start` → `devices.kiosk.enable`, then `devices.terminate`;
- stream credentials only for the visitor who started that phone;
- the limits that keep the bill predictable: demo length, a cap on phones
  running at once, and a per-visitor rate limit;
- cleanup that survives failures: on expiry, on early end, on shutdown, and
  after a restart.

## Requirements

- [Bun](https://bun.sh/)
- a Mobilerun API key with access to Android cloud phones

## Run it

```bash
cd examples/typescript/try-our-app
bun install
cp .env.example .env   # set MOBILERUN_CLOUD_API_KEY
bun run dev            # http://localhost:3000
bun run check          # tests (the SDK is faked), typecheck, build
```

Starting a demo creates a real phone and uses your account's balance. The
server binds to `127.0.0.1` on purpose; change it deliberately when you deploy.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOBILERUN_CLOUD_API_KEY` | none | Server-side API key; never sent to the browser |
| `MOBILERUN_API_URL` | SDK default | API base URL; `/v1` is added when missing |
| `PORT` | `3000` | Listen port |
| `SESSION_SECRET` | random per process | Signs the visitor cookie; 32+ characters, required in production |
| `DEMO_APP_PACKAGE` | `com.android.chrome` | App the phone is locked to; it must be installed |
| `SESSION_TTL_SECONDS` | `300` | Length of one demo |
| `MAX_CONCURRENT_SESSIONS` | `3` | Phones running at once |
| `RATE_LIMIT_MAX` | `3` | Demo starts per visitor (IP and cookie) per hour |

Rarer knobs are constants at the top of `src/server.ts`: boot timeout (120 s),
reaper interval (15 s), rate-limit window (1 h), and the SQLite path. Without
an API key the page still loads and session requests answer `503`.

## How it works

- **Start** (`POST /api/sessions`): the server sets a signed, anonymous visitor
  cookie, checks the rate limit and the cap, then creates the phone with SDK
  retries off (a retried create could leave a second phone nobody tracks). It
  answers once the phone is ready, so Bun's idle timeout is raised to 255 s. A
  visitor who already has a running demo gets that one back.
- **App, then kiosk**: kiosk (Android lock-task) mode pins a running task, so
  the app is started first and kiosk is retried for a few seconds while the
  API reports "no task found".
- **Stream** (`GET /api/sessions/:id/stream`): only the cookie that started the
  session gets credentials; everyone else gets a `404`.
- **One cleanup path**: end, expiry and shutdown all go through one close step.
  A session is marked ended only once its phone is terminated (or the API says
  it is gone). A failed terminate keeps the session open, holding its slot,
  and the reaper retries it every 15 s. A phone that finishes booting after its
  session was closed is terminated, never handed out.
- **Restarts**: sessions are kept in SQLite, so the reaper resumes owed
  terminates. If the process dies between creating a phone and saving its id,
  or is down when a demo expires, that phone keeps billing: list devices named
  `demo-*` and terminate the ones you do not recognize.
- **Errors**: `src/server/api-app.ts` maps every failure to JSON. An API 4xx
  keeps its status and text; a `401`/`403` (your key) or a 5xx becomes a plain
  `502`. Writes are checked by `hono/csrf`. The page shows its own plain line,
  except for this server's own limits (busy, rate limited).
- **Brand**: `brand.json` (company, product, tagline, accent, 24×24 logo path)
  re-themes the page. `src/client/theme.css`, `brand.ts` and `components/` are
  shared verbatim with the other white-label examples; this page's own styles
  are in `src/styles.css`.

## What the API does not do for you

- **One org key.** There are no per-end-user keys; your server holds the key
  and decides who may do what.
- **No metadata on devices.** The API does not know which visitor owns a
  phone. This example keeps that mapping in SQLite; you need your own store.
- **No per-end-user billing.** Usage is billed to your organization; the demo
  length, cap and rate limit are what keep that bill predictable.

## Before production

- Replace the anonymous cookie with your own authentication or a bot check
  before a button click can cost money.
- Use a shared store for sessions and rate limits if you run more than one
  replica, and read the client IP from a proxy header you trust.
- Set `SESSION_SECRET`, keep it and the API key in a secrets manager, and serve
  over HTTPS; the cookie is `Secure` in production.
- Install your real app on the phone (`devices.create` accepts `apps`) and set
  `DEMO_APP_PACKAGE` to it.
- Alert on sessions stuck in `ending`: a phone that is not terminated keeps
  billing.
