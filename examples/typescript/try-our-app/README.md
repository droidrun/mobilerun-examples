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
- locking it to one app with `devices.kiosk.enable()` and launching that app with
  `devices.apps.start()`;
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
   concurrency cap, creates the phone, waits until it is ready, locks it to
   `DEMO_APP_PACKAGE`, starts that app, and returns the session id and expiry.
   A visitor who already has a running demo gets that one back instead of a
   second phone.
2. `GET /api/sessions/:id/stream`: only for the cookie that owns the session.
   Looks up the device and returns `{ streamUrl, streamToken }`. Anyone else
   gets a 404.
3. `DELETE /api/sessions/:id`: the owner ends the demo early; the phone is
   terminated.
4. A reaper loop terminates sessions whose time is up. On `SIGINT` or `SIGTERM`
   the server stops accepting starts and terminates every live phone. Sessions
   are kept in SQLite, so a phone that outlived a crashed server is terminated
   by the reaper once its time is up.
5. API errors (for example an unavailable device type or insufficient balance)
   are returned with the API's own status and message. The browser adds no
   gates of its own.

### Layout

```text
brand.json                   # name, copy, inline SVG logo, colors
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
    └── contracts.ts         # Zod schemas shared by both sides of the boundary
```

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOBILERUN_CLOUD_API_KEY` | none | Server-side API key |
| `MOBILERUN_API_URL` | SDK default | Override the API base URL |
| `DEMO_APP_PACKAGE` | `com.android.chrome` | App the visitor is locked to; it must be installed on the phone |
| `SESSION_TTL_SECONDS` | `300` | Length of one demo |
| `REAPER_INTERVAL_SECONDS` | `15` | How often expired demos are swept |
| `MAX_CONCURRENT_SESSIONS` | `3` | Cap on phones running at once |
| `RATE_LIMIT_MAX` | `3` | Demo starts per visitor per window |
| `RATE_LIMIT_WINDOW_SECONDS` | `3600` | Rate-limit window |
| `PROVISION_TIMEOUT_SECONDS` | `120` | Give up on a phone that is not ready |
| `COOKIE_SECRET` | random per start | Signs the visitor cookie (16+ characters) |
| `SESSIONS_DB_PATH` | `data/sessions.sqlite` | SQLite file |
| `BRAND_FILE` | `brand.json` | Brand definition |

### Branding

Edit `brand.json`. Colors must be `#rrggbb`. The logo is an inline SVG that the
page renders as an image. The brand is validated at startup, so a typo fails
fast.

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
- Set `COOKIE_SECRET` from your secret manager and serve over HTTPS.
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
