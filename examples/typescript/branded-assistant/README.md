# Branded assistant (white-label example)

A fictional travel app, **Quillmoor**, ships its own assistant, **Pip**. Pip
does research on a real Android cloud phone while the traveller chats with it,
follows progress, answers follow-up questions and gets a structured result
card. Each traveller has a credit budget that the example's **own server**
keeps.

The point: a third party can build a branded product on top of the Mobilerun
API and its end users never see Mobilerun. The only place the name appears in
the UI is the operator notice shown when the API key is missing.

If you only want the basic "start a task and watch the device" flow, read the
[task runner](../task-runner/) first. This example builds on it and differs in
four ways:

| | Task runner | Branded assistant |
| --- | --- | --- |
| Who is the user? | One anonymous person | Many end users, each with a session |
| Quota | None | Per-user credit ledger: reserve, settle, refund |
| Persona | None | Name, tone and system prompt in `assistant.json`, never sent to the browser |
| Conversation | One task, one result | Presets, live progress, follow-up questions via `tasks.sendMessage()` |
| Ids | Mobilerun task id in the URL | Your own run ids; Mobilerun task ids stay on the server |

## What it shows

- a chat UI themed from `brand.json` (colors and logo are mapped onto the CSS
  variables that `@mobilerun/react` reads);
- 2–3 request presets (cheapest hotel, flight deals, ask anything), each with a
  structured output schema described with zod and rendered as a result card;
- live progress from `tasks.getStatus()` polling, shown as a timeline;
- follow-up questions answered with `tasks.sendMessage()`;
- cancelling with `tasks.stop()`, final output and `creditsUsed` from
  `tasks.retrieve()`;
- an optional, collapsed "watch" panel using `<DeviceStream hasControl={false}>`;
- a SQLite credit ledger (`bun:sqlite`) with atomic reservation and settlement;
- a stub, signed, HttpOnly session cookie (`hono/cookie`).

## Run it

Requirements: [Bun](https://bun.sh/), a Mobilerun API key and at least one
Android cloud phone (`android_cloud_phone`) in your organization.

```bash
cd examples/typescript/branded-assistant
bun install
cp .env.example .env
bun run dev
```

Set the values in `.env`:

```dotenv
MOBILERUN_API_KEY=dr_sk_...
DEVICE_IDS=<device-id>[,<device-id>...]
SESSION_SECRET=<openssl rand -hex 32>
```

Open [http://localhost:3000](http://localhost:3000). Without an API key the
server still starts and the page shows an **API key missing** notice.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOBILERUN_API_KEY` | – | Organization API key. Server only; never sent to the browser. |
| `MOBILERUN_API_URL` | SDK default | Optional API base; `/v1` is appended when missing. |
| `SESSION_SECRET` | random per start (development only) | Signs the session cookie. At least 32 characters; required in production. |
| `DEVICE_IDS` | – | Comma-separated cloud phone ids this app may use. |
| `STARTING_BUDGET` | `100` | Credits a new user starts with. |
| `RESERVE_PER_RUN` | `20` | Credits held while a request runs. |
| `DATABASE_PATH` | `data/ledger.sqlite` | SQLite file for accounts and runs. |
| `PORT` | `3000` | Always bound to `127.0.0.1`. |

Customize the product in two files:

- `brand.json`: `name`, inline `logoSvg`, `colors.primary`, `colors.background`;
- `assistant.json`: persona (`displayName`, `tagline`, `tone`), `systemPrompt`,
  `maxSteps`, `executionTimeout`, optional `llmModel`, and `presets`. Each
  preset has an `instruction` and `outputFields`; the same fields build the
  task's JSON Schema (with zod) and the result card.

Both files are validated at startup. The system prompt, tone and model id are
only ever used on the server.

## How it works

```text
browser ──same-origin /api/*, session cookie──▶ Bun + Hono ──@mobilerun/sdk──▶ Mobilerun API
   │                                               │
   │                                               └── SQLite ledger: accounts, runs
   └── @mobilerun/react + short-lived stream token ───────────────────────────▶ phone stream
```

1. **Identity.** `src/server/session.ts` gives each browser a signed user id.
   Everything below only reads that id.
2. **Start.** `POST /api/runs` takes `{ presetId, message }`. The server picks a
   free phone from `DEVICE_IDS`, reserves `RESERVE_PER_RUN` credits in one
   atomic SQL statement (`balance >= amount`), and only then calls
   `tasks.run()` with the persona's system prompt, the preset's output schema
   and the step/time limits. If credits are short, it answers `402` and no task
   starts. If the API rejects the start (for example the device type is
   unavailable or the balance is too low), the reservation is refunded and the
   API's 4xx/422 error is returned as it came.
3. **Follow.** The browser polls `GET /api/runs/:id`. The server asks
   `tasks.getStatus()` and returns a narrow view: status, a progress timeline,
   a pending question if any, and the stream credentials for the owner's
   active run.
4. **Ask and answer.** Mobilerun has no "waiting for input" state, so a run
   shows a question when the agent's latest message ends with `?`. The user
   can send a message at any time while the run is active
   (`POST /api/runs/:id/messages` → `tasks.sendMessage()`).
5. **Settle.** A server-side watcher keeps polling after the user closes the
   tab. When the task ends it reads `output` and `creditsUsed` with
   `tasks.retrieve()`, charges `min(ceil(creditsUsed), reserved)` and refunds the
   rest. Failed and cancelled runs charge only what they used. Settlement runs
   once per run.
6. **Ownership.** Every run route filters by the session's user id. Someone
   else's run id answers `404`, exactly like an unknown id.

Phones are exclusive: one active run per phone, tracked in process. When every
phone is busy the API answers `409 device_busy` instead of queueing, which
keeps the example small. After a restart, open runs are picked up again from
the database.

```text
src/
├── client/                  # chat UI, polling hook, brand mapping
├── server/
│   ├── api-app.ts           # Hono routes and error mapping
│   ├── assistant-config.ts  # assistant.json validation, output schema (zod)
│   ├── assistant-service.ts # reserve → run → settle, queue, progress
│   ├── config.ts            # zod-validated environment
│   ├── ledger.ts            # SQLite accounts and runs
│   ├── mobilerun-adapter.ts # the only module that touches @mobilerun/sdk
│   └── session.ts           # stub identity (replace this)
├── shared/                  # zod contracts, brand schema
└── server.ts
```

Tests use a fake adapter and a temporary SQLite file; they never call the
network.

## What the Mobilerun API does not do for you

- **One organization key.** There are no sub-accounts and no per-end-user API
  keys. Every call uses your key, so your server decides who may do what.
- **No metadata or tags on devices or tasks.** You cannot ask Mobilerun "which
  tasks belong to user 42". Keep that mapping in your own database (the
  `runs` table here).
- **No per-end-user billing.** Usage is billed to your organization.
  `creditsUsed` on a finished task tells you what one run cost; turning that
  into per-user balances, pricing and top-ups is your job (the ledger here).
- **No "needs input" status.** Follow-up questions are a convention on top of
  the agent's text, as described above, and `lastResponse` is an untyped
  object, so the progress text is a best-effort read of it.
- **Stream tokens are device-level credentials.** `hasControl={false}` only
  makes the viewer read-only in the UI. Anyone holding the token can open the
  stream, so only hand it to the user who owns the active run, or leave the
  watch panel out.

## Before production

- Replace the stub auth in `src/server/session.ts` with your real
  authentication. The signed cookie only separates browsers; it proves nothing
  about a person.
- Use a persistent, backed-up store instead of a local SQLite file, and keep
  the reserve and settle steps atomic in it. The in-process phone locks need a
  shared lock (or a database row) when you run more than one replica.
- Add rate limiting and request auditing, plus CSRF protection suited to your
  auth (the cookie is `SameSite=Lax`).
- Manage secrets properly: `MOBILERUN_API_KEY` and `SESSION_SECRET` come from a
  secret store, never from the repository.
- Decide who may create phones and how many; this example only uses phones
  you list in `DEVICE_IDS`.

## Verify

```bash
bun run check
```
