---
name: mobilerun-try-our-app
description: Build, adapt, run, or troubleshoot a white-label "try our app live" page where a visitor gets a disposable Android cloud phone locked to one app (kiosk mode), controls it in the browser under the brand's look for a limited time, and the phone is terminated afterwards. Use for devices.create/waitReady/apps.start/kiosk/terminate flows, session TTL and reaping, per-visitor rate limits, stream-credential ownership, brand theming of @mobilerun/react, or the bundled try-our-app example. Do not use for task runners, Python webhook receivers, or direct browser-side Mobilerun API calls.
---

# Mobilerun try-our-app

Use the repository's runnable
[try-our-app example](../../examples/typescript/try-our-app/) as the source of
truth. Resolve this link relative to this `SKILL.md`, even when the current
working directory is elsewhere. Keep its server/browser trust boundary and
session lifecycle when adapting it.

## Workflow

1. Read the example's
   [`README.md`](../../examples/typescript/try-our-app/README.md),
   [`package.json`](../../examples/typescript/try-our-app/package.json),
   [`.env.example`](../../examples/typescript/try-our-app/.env.example), and
   [`brand.json`](../../examples/typescript/try-our-app/brand.json).
2. Install `@mobilerun/sdk` and `@mobilerun/react` from npm. Keep
   `MOBILERUN_CLOUD_API_KEY` on the server.
3. Every SDK call and the session lifecycle live in
   `src/server/session-service.ts`; sessions persist in
   `src/server/session-store.ts` (SQLite). Tests fake the SDK client.
4. To rebrand, edit `brand.json` (company, product, tagline, `#rrggbb` accent,
   24×24 SVG logo path). `src/client/theme.css`, `src/client/brand.ts` and
   `src/client/components/{app-shell,phone-frame}.tsx` are shared verbatim with
   the other white-label examples; keep them generic and put page-specific
   styles in `src/styles.css`. To lock to another app, set `DEMO_APP_PACKAGE`;
   the app must already be installed on the phone.
5. For offline work, run `bun run check` (tests, typecheck, build). Do not
   create a device.
6. Only when the user explicitly requests live verification, use a valid key to
   start one demo and end it. Report that this consumes account balance.

## Required boundaries

- Use `deviceType: 'android_cloud_phone'` and create with `maxRetries: 0`.
  Keep the API's HTTP status for its errors but show visitors a plain message,
  not upstream text; say "busy" only for the example's own capacity and rate
  limits. Add no client-side gates for quotas or capabilities.
- Start the app before enabling kiosk: lock-task mode needs a running task of
  the package. Retry kiosk briefly while the API says "no task found".
- The browser receives `streamUrl` and `streamToken` only for the session its
  signed visitor cookie owns. Everyone else gets a 404.
- Every demo has a TTL, a reaper that terminates expired sessions, a cap on
  concurrent phones, a per-visitor rate limit, and cleanup on shutdown. Do not
  remove one without replacing it. A session is only marked ended after its
  device is confirmed terminated; keep a failed terminate open for retry, and
  terminate a phone that arrives after its session was closed.
- The API has one org key, no per-end-user keys, no metadata on devices, and no
  per-end-user billing. Keep the visitor-to-device mapping in your own store.
- Keep Mobilerun branding out of the end-user page. Never print or log the API
  key.
- Before production: replace the anonymous cookie with real authentication or a
  bot check, use a shared persistent store and limiter for multiple replicas, and
  alert on phones that fail to terminate.

After changes, run `bun run check` from the example directory.
