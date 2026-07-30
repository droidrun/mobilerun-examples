# Embedded Mobilerun task runner

This example starts a Mobilerun task with the server-side TypeScript SDK and
renders the returned device stream with `@mobilerun/react`.

The Mobilerun API key never reaches the browser:

```text
browser ──same-origin HTTP──▶ Bun + Hono ──@mobilerun/sdk──▶ Mobilerun API
   │
   └────@mobilerun/react + short-lived token───────────────▶ device stream
```

## What it demonstrates

- starting a task with `client.tasks.run()`;
- listing available devices and selecting one for the task;
- resolving `streamUrl` and `streamToken` from the selected device;
- polling a narrow server endpoint for task status and structured output;
- cancelling a running task with `client.tasks.stop()`;
- refreshing stream credentials from the task's device when necessary;
- expiring and bounding the in-memory stream credential cache;
- polling without overlapping task-status requests;
- keeping the secret API key on the server.

This is deliberately called a **task runner**. Mobilerun trigger flows are a
separate automation surface with triggers, actions, and executions.

## Requirements

- [Bun](https://bun.sh/)
- a Mobilerun API key

All dependencies come from npm. The example does not use local package
overrides.

## Install

```bash
cd examples/typescript/task-runner
bun install
cp .env.example .env
```

Set the server-side key:

```dotenv
MOBILERUN_CLOUD_API_KEY=dr_sk_...
```

The example always binds to `127.0.0.1`; it cannot accidentally expose its
unauthenticated task and stream-credential routes to the local network. Put an
authenticated application or reverse proxy in front of it before making it
remotely accessible.

## Run

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

The browser calls only the local `/api/runs` routes. The live WebSocket is
opened directly against the short-lived `streamUrl`; it is not proxied through
the example server.

## API routes

| Route | Purpose |
| --- | --- |
| `GET /api/devices` | List available devices through `devices.list()` |
| `POST /api/runs` | Validate a small public input contract and call `tasks.run()` |
| `GET /api/runs/:taskId` | Return a narrow task status/result view |
| `POST /api/runs/:taskId/cancel` | Call `tasks.stop()` |
| `GET /api/health` | Report whether the server SDK is configured |

The start route requires `deviceId` and intentionally accepts only `task`,
`llmModel`, `deviceId`, and `maxSteps`. Sensitive or expensive SDK options
cannot be passed through from the browser.

The server adds a fixed output schema with a short `summary` and an
`observations` list. Keeping the schema server-side prevents the browser from
requesting arbitrarily large or complex outputs.

## Architecture

The example keeps each boundary explicit:

```text
src/
├── client/
│   ├── components/          # device, form, and telemetry UI
│   ├── api-client.ts        # same-origin browser transport
│   ├── runner-machine.ts    # pure run lifecycle reducer
│   └── use-task-runner.ts   # cancellable start + serial polling
├── server/
│   ├── api-app.ts           # narrow Hono routes
│   ├── mobilerun-adapter.ts # the only Mobilerun SDK adapter
│   ├── run-session-store.ts # bounded, expiring stream credentials
│   └── task-service.ts      # SDK-independent task orchestration
└── shared/
    └── contracts.ts         # Zod schemas shared by both boundaries
```

Browser `fetch()` calls stop at the same-origin `/api/*` routes. Every call from
the server to Mobilerun goes through the published `@mobilerun/sdk`; the live
device UI and control channel use the published `@mobilerun/react` package.

## Verify

```bash
bun run check
```

## Production notes

This is a focused integration example, not a multi-user application. Before
deploying it publicly:

- add your own user authentication and authorization;
- associate task IDs with the authenticated user;
- add rate limiting and request auditing;
- replace the bounded in-memory credential store when running multiple replicas;
- review which task options your users may control.
