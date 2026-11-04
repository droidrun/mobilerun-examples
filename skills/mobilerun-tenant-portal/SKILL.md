---
name: mobilerun-tenant-portal
description: Build, run, adapt, or troubleshoot a white-label portal where a reseller's end users each own one Mobilerun cloud Android device, with server-enforced ownership, one device per user, and a live @mobilerun/react stream. Use for per-user device provisioning, device lifecycle routes (create, stop, resume, reboot, reset, terminate), mapping your own users to devices, or the bundled Bun, Hono, SQLite, and React tenant-portal example. Do not use for task runners, webhook receivers, or direct browser-side Mobilerun API calls.
---

# Mobilerun tenant portal

Use the repository's runnable
[TypeScript tenant portal](../../examples/typescript/tenant-portal/) as the
source of truth. Resolve this link relative to this `SKILL.md`, even when the
current working directory is elsewhere. Preserve its ownership model when
adapting it.

## Workflow

1. Read the example's
   [`README.md`](../../examples/typescript/tenant-portal/README.md),
   [`package.json`](../../examples/typescript/tenant-portal/package.json),
   [`.env.example`](../../examples/typescript/tenant-portal/.env.example), and
   [`brand.json`](../../examples/typescript/tenant-portal/brand.json).
2. Install `@mobilerun/sdk` and `@mobilerun/react` from npm. Keep
   `MOBILERUN_CLOUD_API_KEY` on the server and use `MOBILERUN_API_URL` only to
   override the default API base.
3. Every SDK call, ownership and the device lifecycle live in
   `src/server/portal-service.ts`; users and device links persist in
   `src/server/store.ts` (SQLite); the environment is read in
   `src/server/config.ts`; `src/server/api-app.ts` holds the routes and the one
   error mapping. Tests fake the SDK client.
4. Sign-in is a stub: `POST /api/login` in `src/server/api-app.ts` signs anyone
   in as any email, and `src/server/session.ts` is its cookie. To adapt the
   example, replace both together with your identity provider; the rest only
   needs a user id. Keep a user-to-device table in your own database.
5. To rebrand, edit `brand.json` (company, product, tagline, `#rrggbb` accent,
   24×24 SVG logo path). `src/client/theme.css`, `src/client/brand.ts` and
   `src/client/components/` (app shell, notice, phone frame) are shared verbatim
   with the other white-label examples; keep them generic and put page-specific
   styles in `src/styles.css`.
6. For offline work, run `bun run check` (tests, typecheck, build). Do not
   create a real device.
7. Only when the user explicitly requests live verification, use a valid key to
   create, control, and then terminate a real device. Report that this consumes
   account balance.

## Required boundaries

- Never send `MOBILERUN_CLOUD_API_KEY` to the browser, and never send the Mobilerun
  device id: the browser needs only `streamUrl` and `streamToken`.
- Resolve the device from the signed-in user's own row on every route. Never
  accept a device id from the client; a foreign or missing device is a `404`.
- Enforce one device per user on the server, answer with `409`, create with
  `deviceType: 'android_cloud_phone'` and `maxRetries: 0`, and terminate (and
  log) a device that was created but could not be linked. Remove ownership rows
  only by `(user, device)` of the device the request captured.
- The Mobilerun API has one organization key, no sub-accounts, no
  per-end-user keys, no metadata or tags on devices, and no per-end-user
  billing. Ownership, quotas, and charging belong in your own server and DB.
- Pass Mobilerun 4xx errors on with their status and text, and turn a `401`,
  `403` or 5xx into a plain `502`; never map an upstream `401`/`403` to the end
  user's session. Do not add client-side gates for quotas, capabilities, or
  balance. Do not show upstream state text; label states in your own words.
  Keep `hono/csrf` on `/api/*`.
- Let the server decide whether a device can stream: the browser asks, retries
  with backoff, and asks again on reconnect, dropping answers that arrive after
  sign-out or a state change. Poll device state one request at a time and keep
  polling through failures, the first load included.
- Keep Mobilerun branding out of the end-user page. Never print or log the API
  key.
- Keep the stub login local-only. Require a real identity provider, server-side
  session expiry, rate limiting, a persistent store, and secrets management
  before deployment.

After changes, run `bun run check` from the tenant-portal directory. Never
perform live device actions unless the user explicitly requests them.
