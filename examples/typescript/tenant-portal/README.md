# Tenant portal: a white-label phone per user

A fictional company, **Fernly**, sells **Fernly Phone**: an Android cloud phone
under its own brand. Each customer signs in, owns at most one phone, and can
get it, stop and start it, restart it, reset it, delete it, and use it live in
the browser. Customers never see Mobilerun; Fernly's server talks to the
Mobilerun API with one organisation key.

```text
browser ──cookie session──▶ Bun + Hono ──@mobilerun/sdk──▶ Mobilerun API
   │                            └── SQLite: users, and which device each one owns
   └──@mobilerun/react + short-lived stream token──────▶ phone stream
```

## What it shows

- ownership enforced by your own server: every device route resolves the
  device from the signed-in user's row, never from a client-supplied id;
  anything else is a `404`;
- one device per user (a unique index, `409` for a second one);
- the lifecycle with `devices.create`, `retrieve`, `stop`, `resume`, `reboot`,
  `reset` and `terminate`;
- stream credentials only for the caller's own phone, decided by the server;
- a brand file (`brand.json`) that re-themes the whole page from one accent
  colour.

## Run it

You need [Bun](https://bun.sh/) and a Mobilerun API key with access to Android
cloud phones.

```bash
cd examples/typescript/tenant-portal
bun install
cp .env.example .env   # set MOBILERUN_CLOUD_API_KEY
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with any email.
**Get my phone** creates a real phone and uses your account's balance. The
server binds to `127.0.0.1`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOBILERUN_CLOUD_API_KEY` | none | Server-side API key; never sent to the browser |
| `MOBILERUN_API_URL` | SDK default | API base URL; `/v1` is added when missing |
| `PORT` | `3000` | Listen port |
| `SESSION_SECRET` | random per process | Cookie signing secret, at least 32 characters; required in production |
| `DATABASE_PATH` | `./data/portal.sqlite` | SQLite file |

Without an API key the page still loads; device requests answer
`500 missing_api_key` and the server logs a warning. With `SESSION_SECRET`
empty, sessions reset whenever the server restarts.

## How it works

- **Sign-in** (`POST /api/login`) is the stub: any email signs in as that user
  and gets a signed `HttpOnly`, `SameSite=Lax` cookie. Replace this route
  together with `src/server/session.ts` by your identity provider. Writes are
  also checked by `hono/csrf`.
- **One device per user**: `POST /api/device` creates the phone with SDK retries
  off (a retried create could bill a second phone) and links its id to the
  user. If the link cannot be stored, the new phone is terminated again and its
  id is logged. The Mobilerun device id never reaches the browser.
- **Actions**: `POST /api/device/:action` (`stop`, `resume`, `reboot`, `reset`)
  and `DELETE /api/device` always act on the caller's own device. Cleanup only
  removes the link to the device that request looked up, so a late request
  cannot unlink a replacement phone.
- **State**: `GET /api/device` returns `{ state, createdAt }`. A device that is
  gone upstream is unlinked. The page polls one request at a time while the
  phone moves between states and backs off while requests fail.
- **Stream**: `GET /api/device/stream` returns `streamUrl` and `streamToken`, or
  `409` while the phone is not streaming. The page asks on every state change,
  retries with backoff, and asks again when the stream reconnects.
- **Errors**: the server's own refusals and Mobilerun's 4xx answers (for
  example an unavailable device type or an insufficient balance) keep their
  status and text. A `401`/`403` from the API means your key is wrong, not the
  user's session, so it becomes a plain `502`.

## What the Mobilerun API does not do for you

- **One org key.** There are no sub-accounts and no per-end-user keys; your
  server holds the key and decides who may touch which device.
- **No metadata on devices.** The API does not know which customer owns a
  phone. This example keeps that mapping in SQLite; the `tenant-<userId>`
  device name is a convenience, not access control.
- **No per-end-user billing.** Usage is billed to your organization; charging
  customers and capping what each one can spend is your job.

## Before production

- Replace the stub login and `src/server/session.ts` with your identity
  provider. The cookie is only a signed user id: there is no server-side expiry
  or revocation.
- Set `SESSION_SECRET` (`openssl rand -hex 32`) and keep it and the API key in a
  secrets manager. Serve over HTTPS; the cookie is `Secure` in production.
- Use a persistent, backed-up database if you run more than one process.
- Add rate limiting and auditing, especially on device creation.
- Upstream 4xx text is shown as the API returned it; map it to your own copy.

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
