---
name: mobilerun-tenant-portal
description: Build, run, adapt, or troubleshoot a white-label portal where a reseller's end users each own one Mobilerun cloud Android device, with server-enforced ownership and quota and a live @mobilerun/react stream. Use for per-user device provisioning, device lifecycle routes (create, stop, resume, reboot, reset, terminate), mapping your own users to devices, or the bundled Bun, Hono, SQLite, and React tenant-portal example. Do not use for task runners, webhook receivers, or direct browser-side Mobilerun API calls.
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
   [`package.json`](../../examples/typescript/tenant-portal/package.json), and
   [`.env.example`](../../examples/typescript/tenant-portal/.env.example).
2. Install `@mobilerun/sdk` and `@mobilerun/react` from npm. Keep
   `MOBILERUN_API_KEY` on the server and use `MOBILERUN_API_URL` only to
   override the default API base.
3. Keep SDK calls behind the server adapter. Keep the browser contract in
   zod schemas that do not depend on SDK response types.
4. To adapt it, replace the stub session in `src/server/session.ts` with your
   identity provider, keep a user-to-device table in your own database, and
   restyle through `brand.json`.
5. For offline work, run `bun run check`. Do not create a real device.
6. Only when the user explicitly requests live verification, use a valid key to
   create, control, and then terminate a real device. Report that this consumes
   Mobilerun resources.

## Required boundaries

- Never send `MOBILERUN_API_KEY` to the browser, and never send the Mobilerun
  device id: the browser needs only `streamUrl` and `streamToken`.
- Resolve the device from the signed-in user's own row on every route. Never
  accept a device id from the client; a foreign or missing device is a `404`.
- Enforce the quota on the server, answer with `409`, and clean up a device
  that was created but could not be linked.
- The Mobilerun API has one organisation key, no sub-accounts, no
  per-end-user keys, no metadata or tags on devices, and no per-end-user
  billing. Ownership, quotas, and charging belong in your own server and DB.
- Show Mobilerun 4xx errors as returned; do not add client-side gates for
  quotas, capabilities, or balance. Do not map an upstream `401` or `403` to
  the end user's session.
- Use `deviceType: 'android_cloud_phone'`. Treat `streamUrl` and `streamToken`
  as short-lived credentials and refetch them when the stream reconnects.
- Keep the stub login local-only. Require a real identity provider, rate
  limiting, a persistent store, and secrets management before deployment.

## Architecture

- `src/server/mobilerun-adapter.ts`: the only `@mobilerun/sdk` calls;
- `src/server/portal-service.ts`: ownership, quota, and orchestration;
- `src/server/store.ts`: SQLite users and device ownership;
- `src/server/session.ts`: stub signed-cookie session;
- `src/server/api-app.ts`: validation, error mapping, and the route surface;
- `src/shared/contracts.ts`: schemas shared across the trust boundary;
- `src/client/`: sign-in, device card, and the live `DeviceStream` screen.

After changes, run `bun run check` from the tenant-portal directory. Never
perform live device actions unless the user explicitly requests them.
