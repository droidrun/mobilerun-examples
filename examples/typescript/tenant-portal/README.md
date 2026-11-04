# Tenant portal: a white-label phone per user

New to the API? Read the [task runner](../task-runner/) example first.

A fictional company, **Fernly**, sells **Fernly Phone**: an Android cloud phone
under its own brand. Each customer signs in, owns at most one phone, and can
get it, stop and start it, restart it, reset it, delete it, and use it live in
the browser. Customers never see Mobilerun; Fernly's server talks to the
Mobilerun API with one organization key.

```text
browser ──cookie session──▶ Bun + Hono ──@mobilerun/sdk──▶ Mobilerun API
   │                            └── SQLite: users, and which device each one owns
   └──@mobilerun/react + short-lived stream token──────▶ phone stream
```

## What it demonstrates

- ownership enforced by your own server: every device route resolves the
  device from the signed-in user's row, never from a client-supplied id;
  anything else is a `404`;
- one device per user (a unique index, `409` for a second one);
- the lifecycle with `devices.create`, `retrieve`, `stop`, `resume`, `reboot`,
  `reset` and `terminate`;
- stream credentials only for the caller's own phone, decided by the server.

## Requirements

- [Bun](https://bun.sh/)
- a Mobilerun API key with access to Android cloud phones

## Run it

```bash
cd examples/typescript/tenant-portal
bun install
cp .env.example .env   # set MOBILERUN_CLOUD_API_KEY
bun run dev            # http://localhost:3000
bun run check          # tests (the SDK is faked), typecheck, build
```

Sign in with any email. **Get my phone** creates a real phone and uses your
account's balance. The server binds to `127.0.0.1` on purpose; change it
deliberately when you deploy.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOBILERUN_CLOUD_API_KEY` | none | Server-side API key; never sent to the browser |
| `MOBILERUN_API_URL` | SDK default | API base URL; `/v1` is added when missing |
| `PORT` | `3000` | Listen port |
| `SESSION_SECRET` | random per process | Signs the session cookie; 32+ characters, required in production |
| `DATABASE_PATH` | `./data/portal.sqlite` | SQLite file |

Without an API key the page still loads and device requests answer `503`.
With `SESSION_SECRET` empty, sessions reset whenever the server restarts.

## How it works

- **Sign-in is a stub.** `POST /api/login` signs anyone in as the email they
  type, with a signed `HttpOnly`, `SameSite=Lax` cookie. It stands in for your
  identity provider: replace that route and `src/server/session.ts` together.
  The rest of the server only needs a user id.
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
  phone moves between states, and backs off while requests fail.
- **Stream**: `GET /api/device/stream` returns `streamUrl` and `streamToken`, or
  `409` while the phone is not streaming. The page asks on every state change
  and after every reconnect, and retries with backoff.
- **Errors**: `src/server/api-app.ts` maps every failure to JSON. An API 4xx
  (an unavailable device type, an insufficient balance) keeps its status and
  text; a `401`/`403` (your key, not the user's session), a 5xx, or an API
  that cannot be reached (connection error, timeout) becomes a plain `502`.
  Writes are checked by `hono/csrf`.
- **Brand**: `brand.json` (company, product, tagline, accent, 24×24 logo path)
  re-themes the page. `src/client/theme.css`, `brand.ts` and `components/` are
  shared verbatim with the other white-label examples; this page's own styles
  are in `src/styles.css`.

## What the API does not do for you

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
- Set `SESSION_SECRET` (`openssl rand -hex 32`), keep it and the API key in a
  secrets manager, and serve over HTTPS; the cookie is `Secure` in production.
- Use a persistent, backed-up database if you run more than one process.
- Add rate limiting and auditing, especially on device creation.
- API 4xx text is shown as the API returned it; map it to your own copy.
