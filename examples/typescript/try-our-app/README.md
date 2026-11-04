# Try our app: a white-label live demo

A fictional company, **Fernly**, puts a "Start demo" button on its website. A
visitor clicks it, gets a disposable Android cloud phone locked to the Fernly
app (kiosk mode), uses it in the browser for a few minutes, and the phone is
terminated afterwards. The visitor never sees Mobilerun.

```text
browser ──same-origin HTTP──▶ Bun + Hono ──@mobilerun/sdk──▶ Mobilerun API
   │                              └── SQLite: which session owns which phone
   └──@mobilerun/react + short-lived stream token──────────▶ phone stream
```

## What it shows

- one phone per visitor: `devices.create` → `devices.waitReady` →
  `devices.apps.start` → `devices.kiosk.enable`, then `devices.terminate`;
- stream credentials (`streamUrl`, `streamToken`) only for the visitor who
  started that phone;
- the limits that keep the bill predictable: demo length, a cap on phones
  running at once, and a per-visitor rate limit;
- cleanup that survives failures: on expiry, on early end, on shutdown, and
  after a restart;
- a brand file (`brand.json`) that re-themes the whole page from one accent
  colour.

## Run it

You need [Bun](https://bun.sh/) and a Mobilerun API key with access to Android
cloud phones.

```bash
cd examples/typescript/try-our-app
bun install
cp .env.example .env   # set MOBILERUN_CLOUD_API_KEY
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). Starting a demo creates a
real phone and uses your account's balance. The server binds to `127.0.0.1`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOBILERUN_CLOUD_API_KEY` | none | Server-side API key; never sent to the browser |
| `MOBILERUN_API_URL` | SDK default | API base URL; `/v1` is added when missing |
| `PORT` | `3000` | Listen port |
| `DEMO_APP_PACKAGE` | `com.android.chrome` | App the phone is locked to; it must be installed |
| `SESSION_TTL_SECONDS` | `300` | Length of one demo |
| `MAX_CONCURRENT_SESSIONS` | `3` | Phones running at once |
| `RATE_LIMIT_MAX` | `3` | Demo starts per visitor (IP and cookie) per hour |

Rarer knobs are constants at the top of `src/server.ts`: boot timeout (120 s),
reaper interval (15 s), rate-limit window (1 h), and the SQLite path.

## How it works

- **Start** (`POST /api/sessions`): the server sets a signed, anonymous visitor
  cookie, checks the rate limit and the cap, then creates the phone with SDK
  retries off (a retried create could leave a second phone nobody tracks).
  It answers once the phone is ready, so Bun's idle timeout is raised to 255 s.
- **App, then kiosk**: kiosk (Android lock-task) mode pins a running task, so
  the app is started first and kiosk is retried for a few seconds while the
  API reports "no task found".
- **Stream** (`GET /api/sessions/:id/stream`): only the cookie that started the
  session gets credentials; everyone else gets a 404. A visitor who already has
  a running demo gets that one back instead of a second phone.
- **One cleanup path**: end, expiry and shutdown all go through one close step.
  A session is marked ended only once its phone is terminated (or the API says
  it is gone). A failed terminate keeps the session open, holding its slot,
  and the reaper retries it every 15 s.
- **Late phones**: a phone that finishes booting after its session was closed
  is terminated, never handed to the visitor.
- **Shutdown**: on `SIGINT`/`SIGTERM` the server refuses new starts, interrupts
  phones still booting, and terminates every open session.
- **Restarts**: sessions are kept in SQLite, so the reaper resumes owed
  terminates. If the process dies between creating a phone and saving its id,
  or is down when a demo expires, that phone keeps billing: list devices named
  `demo-*` (`devices.list({ search: 'demo-' })` or the dashboard) and terminate
  the ones you do not recognise.
- **Errors**: API errors keep their HTTP status, their text goes to the server
  log, and the page says "We could not start the demo." Only this server's own
  limits (busy, rate limited) show their own text.

## What the Mobilerun API does not do for you

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
- Serve over HTTPS; keep the cookie secret outside the process (it is random
  per start here, so cookies reset on restart).
- Install your real app on the phone (`devices.create` accepts `apps`) and set
  `DEMO_APP_PACKAGE` to it.
- Alert on sessions stuck in `ending`: a phone that is not terminated keeps
  billing.

## Brand and design

`brand.json` holds the company, product name, tagline, accent colour and a
24×24 SVG path for the logo. `src/client/theme.css` is a small token-based
design system (light and dark), and `src/client/components/` has the app shell
and the phone frame around `@mobilerun/react`. These files are shared verbatim
with the other white-label examples; page-specific styles live in
`src/styles.css`.

## Verify

```bash
bun run check   # tests, typecheck, build
```

The tests fake the SDK and never call the API.
