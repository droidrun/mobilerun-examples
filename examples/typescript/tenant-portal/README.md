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
- a per-user quota (`MAX_DEVICES_PER_USER`, answered with `409` when reached);
- the device lifecycle with `devices.create`, `retrieve`, `stop`, `resume`,
  `reboot`, `reset` and `terminate`;
- a live, controllable screen with `<DeviceStream hasControl>`,
  `<NavigationBar>` and `<StreamStatusPill>` from `@mobilerun/react`;
- Mobilerun API errors (for example an unavailable device type or an
  insufficient balance) shown to the user as the API returned them, with no
  client-side gates;
- a brand file (`brand.json`) that drives the page and the stream components'
  colors, with no Mobilerun branding in the customer UI;
- an optional admin view of all customers and their device state.

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
MOBILERUN_API_KEY=dr_sk_...
```

Open [http://localhost:3000](http://localhost:3000) and sign in with any email.
Without an API key the page still loads and shows an "API key missing" notice.

Creating a device uses your account's balance or plan, so the example does
nothing until you click **Get my phone**.

The server always binds to `127.0.0.1`.

## How it works

1. `POST /api/login { email }` creates the user if needed and sets a signed
   `HttpOnly`, `SameSite=Lax` session cookie (`hono/cookie`, signed with
   `SESSION_SECRET`). `POST /api/logout` clears it. This is a stub.
2. The browser only calls the portal's own `/api/*` routes. The server holds
   `MOBILERUN_API_KEY` and is the only code that calls `@mobilerun/sdk`
   (`src/server/mobilerun-adapter.ts`).
3. SQLite (`bun:sqlite`) stores `users(id, email, created_at)` and
   `devices(user_id, device_id, created_at)`, both unique, so one user owns at
   most one device and one device belongs to at most one user.
4. Creating a device calls `devices.create({ deviceType: 'android_cloud_phone',
   name: 'tenant-<userId>' })` and stores the returned id against the user. The
   Mobilerun device id is never sent to the browser.
5. For the live screen, the server returns only `streamUrl` and `streamToken` of
   the caller's own device. The browser connects to the stream directly.

| Route | What it does |
| --- | --- |
| `POST /api/login`, `POST /api/logout`, `GET /api/me` | stub session |
| `POST /api/device` | create the caller's device (`409` over quota) |
| `GET /api/device` | its state |
| `POST /api/device/stop`, `resume`, `reboot`, `reset` | lifecycle actions |
| `DELETE /api/device` | terminate the device and delete the row |
| `GET /api/device/stream` | `{ streamUrl, streamToken }` |
| `GET /api/admin/users` | users and device state (`ADMIN_EMAILS` only) |
| `GET /api/health` | whether the API key is configured |

Source layout:

```text
brand.json                    # name, logo path, colors
src/
├── server/
│   ├── api-app.ts            # Hono routes and error mapping
│   ├── portal-service.ts     # ownership, quota, device orchestration
│   ├── mobilerun-adapter.ts  # the only @mobilerun/sdk calls
│   ├── store.ts              # SQLite users and device ownership
│   ├── session.ts            # stub signed-cookie session
│   └── config.ts             # zod-validated environment
├── client/                   # sign-in, device card, live screen, admin view
└── shared/contracts.ts       # zod schemas for the browser boundary
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOBILERUN_API_KEY` | none | Organisation API key, server only |
| `MOBILERUN_API_URL` | `https://api.mobilerun.ai/v1` | API base override |
| `SESSION_SECRET` | none | Cookie signing secret, at least 32 characters |
| `DATABASE_PATH` | `./data/portal.sqlite` | SQLite file |
| `MAX_DEVICES_PER_USER` | `1` | `0` closes provisioning, `1` allows one device |
| `ADMIN_EMAILS` | empty | Comma-separated admin emails |
| `PORT` | `3000` | Listen port |

The quota is `0` or `1` because the `devices.user_id` column is unique. To give
users several devices, drop that constraint and add a device id to the routes.

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
cross-user `404`s on every device route, the quota, tampered and unsigned
cookies, logout, termination, and configuration validation.

## Before production

- Replace the stub login with your identity provider. Anyone can sign in as any
  email here, and the cookie has no server-side revocation.
- Use a persistent, backed-up database instead of a local SQLite file, and
  think about concurrent writers.
- Add rate limiting and auditing, especially on device creation.
- Keep `MOBILERUN_API_KEY` and `SESSION_SECRET` in a secrets manager; the server
  refuses the development `SESSION_SECRET` when `NODE_ENV=production`.
- Serve over HTTPS (the session cookie is `Secure` in production) and put the
  server behind your own reverse proxy rather than a local bind.
- Decide how you bill customers and cap what a single customer can spend.
