# Try our app: a white-label live demo

A fictional brand, **Fernly**, puts a "Try it" button on its website. A visitor
clicks it, gets a disposable Android cloud phone locked to one app (kiosk
mode), controls it in the browser under the brand's look for a few minutes, and
the phone is terminated afterwards. The visitor never sees Mobilerun.

```text
browser ──same-origin HTTP──▶ Bun + Hono ──@mobilerun/sdk──▶ Mobilerun API
   │                              │
   │                              └── SQLite: which session owns which device
   └────@mobilerun/react + short-lived token──────────────▶ device stream
```

## What it shows

- creating a phone per visitor with `devices.create({ deviceType: 'android_cloud_phone' })`
  and waiting for it with `devices.waitReady()`;
- launching one app with `devices.apps.start()` and then locking the phone to it
  with `devices.kiosk.enable()`;
- handing the browser only `streamUrl` and `streamToken`, and only to the
  visitor who started that session;
- ending the demo early or on a timer with `devices.terminate()`, and cleaning up
  on server shutdown and after a restart;
- limiting abuse: a rate limit per visitor, a cap on concurrent phones, and a
  session lifetime, all from environment variables;
- a brand file (`brand.json`) mapped to the CSS variables `@mobilerun/react`
  reads, so the stream UI wears the brand's colors.

## Requirements

- [Bun](https://bun.sh/)
- a Mobilerun API key with access to Android cloud phones

All dependencies come from npm; there are no local package overrides.

## Run it

```bash
cd examples/typescript/try-our-app
bun install
cp .env.example .env
bun run dev
```

Set the server-side key in `.env`:

```dotenv
MOBILERUN_CLOUD_API_KEY=dr_sk_...
```

Open [http://localhost:3000](http://localhost:3000). Without a key the page
still loads and shows an "API key missing" notice instead of the Try it button.

Starting a demo creates a real phone and uses your account's balance. The server
binds to `127.0.0.1` only.

## How it works

1. `POST /api/sessions`: the server reads or sets a signed, anonymous visitor
   cookie, applies the rate limit (keyed by IP address and cookie) and the
   concurrency cap, creates the phone, waits until it is ready, starts
   `DEMO_APP_PACKAGE`, locks the phone to it, and returns the session id and
   `expiresInSeconds`. Kiosk mode needs the app running first, which the example
   does for you: it starts the app, then enables kiosk (retrying briefly while
   the API reports that the app's task is not there yet).
   A visitor who already has a running demo gets that one back instead of a
   second phone.
2. `GET /api/sessions/:id/stream`: only for the cookie that owns the session.
   Looks up the device and returns `{ streamUrl, streamToken }`. Anyone else
   gets a 404.
3. `DELETE /api/sessions/:id`: the owner ends the demo early; the phone is
   terminated.
4. A reaper loop terminates sessions whose time is up. On `SIGINT` or `SIGTERM`
   the server stops accepting starts, interrupts phones that are still booting,
   and terminates every live phone. Ending a session goes through one
   terminate path: a row is only marked ended once the device is confirmed
   gone (or the API says it no longer exists). If a terminate fails, the row
   stays open, keeps its concurrency slot, and the reaper retries it on every
   sweep. Sessions are kept in SQLite, so a restart resumes that duty.

   **Limits of crash recovery.** If the process dies between creating a phone
   and saving its id, or the server is down when a demo expires, that phone
   keeps running and keeps billing. Reconcile by listing devices whose name
   starts with `demo-` (`devices.list({ search: 'demo-' })`, or the dashboard)
   and terminating the ones you do not recognize.
5. API errors (for example an unavailable device type or insufficient balance)
   keep the API's own HTTP status; the server logs the details and sends the
   browser a plain message, so visitors never read upstream text. The page
   says the phones are busy only for this example's own limits (concurrency cap,
   rate limit) and otherwise asks the visitor to try again. The browser adds no
   gates of its own.

### Layout

```text
brand.json                   # name, copy, inline SVG logo, two colors
src/
├── client/
│   ├── components/          # demo panel (hero, countdown, CTA) and phone frame
│   ├── api-client.ts        # same-origin browser transport
│   ├── brand.ts             # brand colors → CSS variables
│   ├── demo-machine.ts      # pure demo lifecycle reducer
│   └── use-demo.ts          # start, end, expiry timer, stream refresh
├── server/
│   ├── api-app.ts           # Hono routes, visitor cookie, rate limiting
│   ├── mobilerun-adapter.ts # the only file that touches @mobilerun/sdk
│   ├── rate-limiter.ts      # in-memory sliding window
│   ├── session-service.ts   # SDK-independent session lifecycle
│   └── session-store.ts     # bun:sqlite session records
└── shared/
    ├── brand.ts             # imports and validates brand.json
    └── contracts.ts         # Zod schemas shared by both sides of the boundary
```

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOBILERUN_CLOUD_API_KEY` | none | Server-side API key |
| `MOBILERUN_API_URL` | SDK default | Override the API base URL; `/v1` is added when missing (same as the task-runner example) |
| `PORT` | `3000` | Listen port on `127.0.0.1` |
| `DEMO_APP_PACKAGE` | `com.android.chrome` | App the visitor is locked to; it must be installed on the phone |
| `SESSION_TTL_SECONDS` | `300` | Length of one demo |
| `MAX_CONCURRENT_SESSIONS` | `3` | Cap on phones running at once |
| `RATE_LIMIT_MAX` | `3` | Demo starts per visitor per hour |

Less common knobs are constants in `src/server/config.ts`: the reaper interval
(15 s), the boot timeout (120 s), the rate-limit window (1 h), and the SQLite
path (`data/sessions.sqlite`). The visitor cookie is signed with a random secret
chosen at each start, so visitors lose their session cookie when the server
restarts.

### Branding

Edit `brand.json`: name, copy, an inline SVG logo, and two colors (`primary`
and `background`, both `#rrggbb`). `src/client/brand.ts` sets them as CSS
variables and `src/styles.css` derives the rest (text, card, border, muted)
for both the page and the `@mobilerun/react` components. The logo is rendered as
an image, never as markup. The file is validated when the page loads and in
the tests, so a typo fails fast.

## What the Mobilerun API does not do for you

- **One org key.** There are no sub-accounts and no per-end-user API keys. Your
  server holds the single key and decides who may do what.
- **No metadata or tags on devices or tasks.** The API does not remember which
  visitor a phone belongs to. This example keeps that mapping in its own
  database (`session-store.ts`); you need your own as well.
- **No per-end-user billing.** Usage is billed to your organization. Rate
  limits, the concurrency cap and the session lifetime here are what keep that
  bill predictable.

## Before production

- Replace the anonymous cookie with your own authentication, or add a bot check
  such as CAPTCHA, before the Try it button creates anything that costs money.
- Use a persistent, shared store instead of SQLite on one disk and an in-memory
  rate limiter if you run more than one replica.
- Rate limit at your edge too. This example sees only `127.0.0.1` behind a proxy,
  so read the client IP from a header you trust and pass it to the limiter.
- Serve over HTTPS and keep the visitor-cookie secret outside the process (it
  is random per start here).
- Put your real app on the demo phone before it is locked (`devices.create`
  accepts an `apps` list; `devices.apps.install()` also exists) and point
  `DEMO_APP_PACKAGE` at it.
- Alert when sessions fail to terminate. A phone that is not terminated keeps
  billing.

## Verify

```bash
bun run check
```

The tests use a fake device adapter and never call the API.
