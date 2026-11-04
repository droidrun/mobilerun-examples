# White-label tenant portal

A fictional reseller, **Kestrel MyPhone**, sells a cloud Android phone under its
own brand. Each customer signs in, owns at most one phone, and can create it,
stop and start it, restart it, reset it, delete it, and control it live in the
browser. Customers never see Mobilerun; the reseller's server talks to the
Mobilerun API with one organisation API key.

```text
browser ──cookie session──▶ Bun + Hono (this example) ──@mobilerun/sdk──▶ Mobilerun API
   │                              │
   │                              └── SQLite: users, devices (who owns which device)
   └──@mobilerun/react + short-lived stream token───────────────────────▶ device stream
```

## What it shows

- ownership enforced by the reseller's own server: every device route resolves
  the device from the signed-in user's row, never from a client-supplied id, and
  anything else is a `404`;
- one device per user, enforced by a unique index and answered with `409` when
  the user already has one;
- the device lifecycle with `devices.create`, `retrieve`, `stop`, `resume`,
  `reboot`, `reset` and `terminate`;
- a live, controllable screen with `<DeviceStream hasControl>`,
  `<NavigationBar>` and `<StreamStatusPill>` from `@mobilerun/react`;
- Mobilerun API errors (for example an unavailable device type or an
  insufficient balance) shown to the user as the API returned them, with no
  client-side gates;
- a brand file (`brand.json`) that drives the page and the stream components'
  colors, with no Mobilerun branding in the customer UI.

## Requirements

- [Bun](https://bun.sh/)
- a Mobilerun API key

## Run it

```bash
cd examples/typescript/tenant-portal
bun install
cp .env.example .env
bun run dev
```

Set the server-side key in `.env`:

```dotenv
MOBILERUN_CLOUD_API_KEY=dr_sk_...
```

Open [http://localhost:3000](http://localhost:3000) and sign in with any email.
Without an API key the page still loads and shows an "API key missing" notice.
Leave `SESSION_SECRET` empty for local runs: the server then makes a random one
per process and sessions reset on restart.

Creating a device uses your account's balance or plan, so the example does
nothing until you click **Get my phone**.

The bind address is `127.0.0.1` by design. Change it deliberately when you
deploy.

## How it works

1. `POST /api/login { email }` creates the user if needed and sets a signed
   `HttpOnly`, `SameSite=Lax` session cookie (`hono/cookie`, signed with
   `SESSION_SECRET`). `POST /api/logout` clears it. **The login route is the
   stub:** anyone can sign in as any email. When you wire a real identity
   provider, delete that route and replace `src/server/session.ts` together
   with it. Writes are also guarded by `hono/csrf`.
2. The browser only calls the portal's own `/api/*` routes. The server holds
   `MOBILERUN_CLOUD_API_KEY` and is the only code that calls `@mobilerun/sdk`
   (`src/server/mobilerun-adapter.ts`).
3. SQLite (`bun:sqlite`) stores `users(id, email, created_at)` and
   `devices(user_id, device_id, created_at)`, both unique, so one user owns at
   most one device and one device belongs to at most one user.
4. Creating a device calls `devices.create({ deviceType: 'android_cloud_phone',
   name: 'tenant-<userId>' })` (SDK retries off, so a retry cannot bill twice)
   and stores the returned id against the user. If the id cannot be stored, the
   new device is terminated again. The Mobilerun device id is never sent to the
   browser.
5. For the live screen, the server returns only `streamUrl` and `streamToken` of
   the caller's own device, or `409` while the device is not streaming yet; the
   browser asks, retries with backoff, and connects to the stream directly.

| Route | What it does |
| --- | --- |
| `POST /api/login`, `POST /api/logout`, `GET /api/me` | stub session |
| `POST /api/device` | create the caller's device (`409` if the user already has one) |
| `GET /api/device` | its state |
| `POST /api/device/:action` | `stop`, `resume`, `reboot` or `reset` |
| `DELETE /api/device` | terminate the device and delete the row |
| `GET /api/device/stream` | `{ streamUrl, streamToken }` |
| `GET /api/health` | whether the API key is configured |

Source layout:

```text
brand.json                    # name, logo path, colors
src/
├── server/
│   ├── api-app.ts            # Hono routes and error mapping
│   ├── portal-service.ts     # ownership, one device per user, orchestration
│   ├── mobilerun-adapter.ts  # the only @mobilerun/sdk calls
│   ├── store.ts              # SQLite users and device ownership
│   ├── session.ts            # signed-cookie session (replace with your IdP)
│   └── config.ts             # zod-validated environment
├── client/                   # sign-in, device card, live screen
└── shared/contracts.ts       # zod schemas for the browser boundary
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOBILERUN_CLOUD_API_KEY` | none | Organisation API key, server only |
| `MOBILERUN_API_URL` | `https://api.mobilerun.ai/v1` | API base override (`/v1` is added if missing) |
| `SESSION_SECRET` | random per process | Cookie signing secret, at least 32 characters; required in production |
| `DATABASE_PATH` | `./data/portal.sqlite` | SQLite file |
| `PORT` | `3000` | Listen port |

Each user owns one device. Supporting several would mean dropping the unique
index on `devices.user_id` and adding a device id to the routes.

## Branding

Edit `brand.json`: `name`, `tagline`, `logoPath` (an SVG path in a 24×24 box)
and four colors. `src/brand.ts` maps them onto CSS variables
(`--primary`, `--background`, `--card`, ...) that both the page and the
`@mobilerun/react` components read.

## What the Mobilerun API does not do for you

- **One organisation key.** There are no sub-accounts and no per-end-user API
  keys. Your server holds the only key, so your server must decide who may touch
  which device.
- **No metadata or tags on devices or tasks.** The mapping from your customer
  to a device lives in your own database. The `tenant-<userId>` device name is a
  convenience, not an access control.
- **No per-end-user billing.** Usage lands on your account. Charging your
  customers, and limiting what each can spend, is your job.

## Verify

```bash
bun run check
```

The tests use a fake adapter and a temporary SQLite file. They cover
cross-user `404`s on every device route, one device per user, tampered and
unsigned cookies, cross-origin writes, logout, termination, late requests that
must not touch a replacement device, and configuration validation.

## Before production

- Delete the stub `POST /api/login` route and replace it, together with
  `src/server/session.ts`, with your identity provider.
- There is no server-side session expiry or revocation: the cookie is only a
  signed user id.
- Upstream error text is shown as the API returned it. Map it to your own copy
  for a white-label product.
- Use a persistent, backed-up database instead of a local SQLite file, and
  think about concurrent writers and several server processes.
- Add rate limiting and auditing, especially on device creation.
- Set `SESSION_SECRET` (`openssl rand -hex 32`) and keep it and
  `MOBILERUN_CLOUD_API_KEY` in a secrets manager.
- Serve over HTTPS (the session cookie is `Secure` in production). The bind
  address is local by design; change it deliberately when you deploy, for
  example behind your own reverse proxy.
- Decide how you bill customers and cap what a single customer can spend.
