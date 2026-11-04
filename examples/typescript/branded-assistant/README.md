# Branded assistant (white-label example)

A fictional travel app, **Quillmoor**, ships its own assistant, **Pip**. Pip
does research on a real Android cloud phone while the traveller chats with it,
follows progress, sends notes to the assistant and gets a structured result
card. Each traveller has a credit budget that the example's **own server**
keeps.

The point: a third party can build a branded product on top of the Mobilerun
API and its end users never see Mobilerun. The only place the name appears in
the UI is the operator notice shown when the API key is missing.

If you only want the basic "start a task and watch the device" flow, read the
[task runner](../task-runner/) first. This example builds on it and differs in
these ways:

| | Task runner | Branded assistant |
| --- | --- | --- |
| Who is the user? | One anonymous person | Many end users, each with a session |
| Quota | None | Per-user credit ledger: reserve, settle |
| Persona | None | Name, tone and system prompt in `assistant.json`, never sent to the browser |
| Conversation | One task, one result | Presets, progress, notes via `tasks.sendMessage()`, validated result card |
| Ids | Mobilerun task id in the URL | Your own run ids; Mobilerun task ids stay on the server |
| Device stream | Embedded in the page | Not exposed to end users (see below) |

## What it shows

- a chat UI themed from `brand.json` (colors and logo are mapped onto the CSS
  variables that `@mobilerun/react` reads);
- 3 request presets (cheapest hotel, flight deals, ask anything). Each
  preset's output is a zod schema: it generates the task's JSON Schema with
  `z.toJSONSchema`, validates the output that comes back, and labels the result
  card;
- progress from the server's polling of `tasks.getStatus()`, shown as a
  timeline of steps;
- notes to the running assistant with `tasks.sendMessage()`;
- cancelling with `tasks.stop()`, final output and `creditsUsed` from
  `tasks.retrieve()`;
- a SQLite credit ledger (`bun:sqlite`) with atomic reservation and
  settlement, one active run per user and per phone;
- a stub, signed, HttpOnly session cookie (`hono/cookie`) with CSRF
  protection (`hono/csrf`).

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
MOBILERUN_CLOUD_API_KEY=dr_sk_...
DEVICE_IDS=<device-id>[,<device-id>...]
```

Open [http://localhost:3000](http://localhost:3000). Without an API key the
server still starts and the page shows an **API key missing** notice.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOBILERUN_CLOUD_API_KEY` | – | Organization API key. Server only; never sent to the browser. |
| `MOBILERUN_API_URL` | SDK default | Optional API base; `/v1` is appended when missing. |
| `SESSION_SECRET` | random per process (development only) | Signs the session cookie. At least 32 characters (`openssl rand -hex 32`); required in production. |
| `DEVICE_IDS` | – | Comma-separated cloud phone ids this app may use. |
| `STARTING_BUDGET` | `100` | Credits a new user starts with. |
| `RESERVE_PER_RUN` | `20` | Credits held while a request runs. |
| `DATABASE_PATH` | `data/ledger.sqlite` | SQLite file for accounts and runs. |
| `PORT` | `3000` | Always bound to `127.0.0.1`. |

Customize the product in three places:

- `brand.json`: `name`, inline `logoSvg`, `colors.primary`, `colors.background`;
- `assistant.json`: persona (`displayName`, `tagline`, `tone`), `systemPrompt`,
  `maxSteps`, `executionTimeout`, optional `llmModel`;
- `src/server/presets.ts`: the request presets, each with an `instruction` and
  a zod `output` schema (`title` becomes the result card label).

Both JSON files are validated at startup. The system prompt, tone, model id
and output schema are only ever used on the server.

## How it works

```text
browser ──same-origin /api/*, session cookie──▶ Bun + Hono ──@mobilerun/sdk──▶ Mobilerun API
                                                   │
                                                   └── SQLite ledger: accounts, runs
```

1. **Identity.** `src/server/session.ts` gives each browser a signed user id.
   Everything below only reads that id.
2. **Start.** `POST /api/runs` takes `{ presetId, message }`. The server picks a
   free phone from `DEVICE_IDS`, reserves `RESERVE_PER_RUN` credits in one
   atomic SQL transaction (balance covers it, user has no other active run),
   and only then calls `tasks.run()` with the persona's system prompt, the
   preset's output schema and the step/time limits. A user with an active run
   gets `409 run_active`; a short balance gets `402`.
   - If the API rejects the start with a 4xx (for example the device type is
     unavailable or the balance is too low), the reservation is refunded and
     the API's error is returned as it came.
   - If the outcome is unclear (timeout, 5xx, network error, or a database
     failure after the task was accepted), the reservation and the phone are
     kept, the run shows as *checking*, and the server reconciles it. A run
     whose task id is unknown expires at its deadline and is charged in full.
     `tasks.run()` is called with `maxRetries: 0` so a retry can never start
     the task twice.
3. **Follow.** One server-side watcher polls `tasks.getStatus()` for every
   active run and records what it finds. `GET /api/runs/:id` only reads that
   record, so browsers never trigger upstream calls. If the backend cannot be
   reached the run says so instead of showing stale progress. The API can
   report no steps for minutes, so the UI shows "Working…" with elapsed time
   while a run is active, and a "Step N" entry is added only when the step
   count actually increases.
4. **Notes.** While a run is active, the user can send a note to the assistant
   (`POST /api/runs/:id/messages` → `tasks.sendMessage()`). If the API does not
   queue it, the user gets an error and keeps their text.
5. **Settle.** When the task ends the watcher reads `output` and `creditsUsed`
   with `tasks.retrieve()` and charges `min(ceil(creditsUsed), reserved)`,
   refunding the rest. If usage is unknown (`creditsUsed` missing on any end
   state, including failed and cancelled), the whole reservation is charged.
   A run past `executionTimeout` plus a margin is stopped, settled the same
   way, and its phone freed. Settlement happens once per run.
6. **Result.** The output is validated against the preset's zod schema. If it
   does not match, the page says the result could not be read and offers the
   raw JSON collapsed. It is never rendered as a card.
   A task that ends `failed` but carries the assistant's own words (for
   example it declined an off-topic request) is shown as "Couldn't finish",
   with those words as the assistant's reply rather than as an error. The
   status is not remapped.
7. **Ownership.** Every run route filters by the session's user id. Someone
   else's run id answers `404`, exactly like an unknown id.

The progress timeline is kept in memory while a run is active and saved with
the settlement, so finished runs keep it across restarts. After a server
restart, a run that was still active is reconciled and settled, but its
timeline starts empty.

Phones are exclusive: one active run per phone, tracked in process. When every
phone is busy the API answers `409 device_busy` instead of queueing. After a
restart, open runs are picked up again from the database.

```text
src/
├── client/                  # chat UI, polling hook, brand mapping
├── server/
│   ├── api-app.ts           # Hono routes, CSRF, error mapping
│   ├── assistant-config.ts  # assistant.json validation, prompt fencing
│   ├── assistant-deps.ts    # what the service needs from Mobilerun
│   ├── assistant-service.ts # reserve → run, notes, cancel, sessions
│   ├── config.ts            # zod-validated environment
│   ├── ledger.ts            # SQLite accounts and runs
│   ├── mobilerun-adapter.ts # the only module that touches @mobilerun/sdk
│   ├── presets.ts           # presets and their zod output schemas
│   ├── run-watcher.ts       # polling, settlement, deadlines
│   └── session.ts           # stub identity (replace this)
├── shared/                  # zod contracts, brand schema
└── server.ts
```

Tests use a fake adapter, an in-memory SQLite database and a hand-cranked
watcher clock; they never call the network.

## Credits and what you pay

Mobilerun bills the organization behind your API key. The ledger here is your
own accounting on top, and it is a *capped demo charge*: a run never costs the
user more than its reservation, but your organization pays whatever the run
really used. Set `RESERVE_PER_RUN` to cover the worst case of `maxSteps` and
`executionTimeout` in `assistant.json`, or you absorb the difference.

## Device streams are not for end users

Do not hand device stream credentials to end users of a shared phone pool: the
token outlives the run and is not scoped to it, and anyone holding it can
control the phone. This example never sends a `streamUrl` or `streamToken` to
the browser. Show screenshots or the result instead.

## What the Mobilerun API does not do for you

- **One organization key.** There are no sub-accounts and no per-end-user API
  keys. Every call uses your key, so your server decides who may do what.
- **No metadata or tags on devices or tasks.** You cannot ask Mobilerun "which
  tasks belong to user 42". Keep that mapping in your own database (the
  `runs` table here).
- **No per-end-user billing.** Usage is billed to your organization.
  `creditsUsed` on a finished task tells you what one run cost; turning that
  into per-user balances, pricing and top-ups is your job (the ledger here).
- **No "needs input" status.** The example does not guess when the agent is
  asking something. Users can send a note at any time while a run is active.
- **Error text is the API's.** Upstream errors (4xx/422 such as an unavailable
  device or an insufficient balance) are shown as the API returned them. Map
  them to your own copy for a white-label product.

## Before production

- **Replace the stub auth** in `src/server/session.ts` with your real
  authentication. With the stub identity, **clearing cookies gives a new user
  and a fresh budget**: the ledger limits nothing until real auth exists.
- **Single process.** The phone locks and the watcher live in one process's
  memory, and `resume()` assumes one instance. Run one replica, or move all of
  it (locks, run ownership, polling) into a shared store first. Use a
  persistent, backed-up database instead of a local SQLite file, and keep the
  reserve and settle steps atomic in it.
- **Prompt injection.** The traveller's text goes to the agent inside
  `<traveller_request>` / `<traveller_message>` fences that the system prompt
  names as untrusted data, and web pages the agent reads are untrusted too.
  That reduces the risk; it does not remove it. Use dedicated phones with no
  operator accounts or saved credentials on them, and treat everything the
  agent returns as untrusted input.
- Add rate limiting and request auditing. The cookie is `SameSite=Lax` and
  `hono/csrf` rejects cross-origin form posts; review both against your auth.
- Manage secrets properly: `MOBILERUN_CLOUD_API_KEY` and `SESSION_SECRET` come
  from a secret store, never from the repository.
- Decide who may create phones and how many; this example only uses phones
  you list in `DEVICE_IDS`.

## Verify

```bash
bun run check
```
