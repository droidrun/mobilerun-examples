---
name: mobilerun-task-runner
description: Build, run, test, or troubleshoot TypeScript task runners that start Mobilerun tasks server-side and render a live device stream with @mobilerun/react. Use for device selection, tasks.run/status/stop flows, short-lived stream credentials, serial polling, cancellation, or the bundled Bun and React task-runner example. Do not use for Python webhook receivers, workflow triggers or actions, or direct browser-side Mobilerun API calls.
---

# Mobilerun task runner

Use the repository's runnable
[TypeScript task runner](../../examples/typescript/task-runner/) as the source
of truth. Resolve this link relative to this `SKILL.md`, even when the current
working directory is elsewhere. Preserve its server/browser trust boundary and
task lifecycle when adapting it.

## Workflow

1. Read the example's
   [`README.md`](../../examples/typescript/task-runner/README.md),
   [`package.json`](../../examples/typescript/task-runner/package.json), and
   [`.env.example`](../../examples/typescript/task-runner/.env.example).
2. Install `@mobilerun/sdk` and `@mobilerun/react` from npm. Do not add local
   package overrides. Keep `MOBILERUN_CLOUD_API_KEY` on the server and use
   `MOBILERUN_API_URL` only to override the default API base.
3. Keep SDK calls behind a server adapter. Keep validation and public response
   schemas independent from SDK response types.
4. Implement the run lifecycle: list eligible devices, start a task, expose
   scoped stream credentials, poll task status serially, stop on request, and
   remove credentials after a terminal state.
5. For offline work, run tests, typechecking, and the production build. Do not
   start a real task.
6. Only when the user explicitly requests live verification, use a valid key
   and an available device to run and, if needed, cancel a real task. Report
   that this consumes Mobilerun resources.

## Required boundaries

- Never send `MOBILERUN_CLOUD_API_KEY` to the browser or expose raw SDK
  responses through local routes.
- Accept only the documented public task fields. Keep model selection, output
  schema, credentials, and other privileged or expensive SDK options under
  server control.
- Validate request bodies, task IDs, task statuses, device summaries, and
  outbound response shapes before crossing the browser boundary.
- Return only the fields the UI needs. Convert upstream failures to stable,
  non-secret error responses; log enough server-side context to diagnose them
  without logging credentials.
- Treat `streamUrl` and `streamToken` as short-lived credentials. Store them in
  a bounded, expiring server-side cache keyed by task ID, refresh them from the
  task's device when necessary, and delete them for completed, failed, or
  cancelled tasks.
- Poll with one request at a time. Abort requests on reset or unmount, apply a
  timeout, back off after errors, and keep an active task cancellable when a
  poll fails.
- Bind the unauthenticated example server to `127.0.0.1`. Require application
  authentication, per-user task ownership, authorization, rate limiting, and
  auditing before any remote or multi-user deployment.

## Architecture

Preserve the example's responsibility split:

- `src/server/mobilerun-adapter.ts`: published SDK calls and server-owned task
  options;
- `src/server/task-service.ts`: SDK-independent orchestration and narrow task
  views;
- `src/server/run-session-store.ts`: bounded stream-credential lifetime;
- `src/server/api-app.ts`: validation, safe HTTP responses, and route surface;
- `src/shared/contracts.ts`: schemas shared across the trust boundary;
- `src/client/api-client.ts`: same-origin HTTP transport;
- `src/client/runner-machine.ts` and `use-task-runner.ts`: deterministic UI
  lifecycle and non-overlapping polling.

Do not combine trigger workflows with this task-runner lifecycle. Use
`mobilerun-webhooks` for signed webhook receivers and webhook file downloads.

After changes, run `bun run check` from the task-runner directory and run the
skill validator when it is available. Never perform live task or device actions
unless the user explicitly requests them.
