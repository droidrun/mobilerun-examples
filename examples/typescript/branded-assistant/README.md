# Branded assistant: a white-label assistant with per-user credits

A fictional travel app, **Fernly**, ships **Fernly Concierge**: an assistant
named Wren that researches hotels, flights and travel questions on a real
Android cloud phone. A traveller picks a request, follows its progress, sends
notes while it works, and gets a structured result. Each traveller has a
credit budget kept by the example's own server. The traveller never sees
Mobilerun.

```text
browser ──same-origin /api/*, session cookie──▶ Bun + Hono ──@mobilerun/sdk──▶ Mobilerun API
                                                   └── SQLite: accounts, runs, credits
```

New to the API? Read the [task runner](../task-runner/) first; this example
adds users, credits, a persona and your own run ids on top of it.

## What it shows

- `tasks.run` with a server-side persona prompt, step and time limits, and a
  structured output schema per request preset;
- progress from `tasks.getStatus`, notes with `tasks.sendMessage`, stopping
  with `tasks.stop`, output and `creditsUsed` from `tasks.retrieve`;
- presets as zod schemas: `z.toJSONSchema` builds the task's output schema,
  `safeParse` checks what comes back, and the schema's titles label the result;
- a per-user credit ledger with atomic reserve and settle, one active run per
  user and one per phone;
- your own run ids and a stub session cookie; Mobilerun task ids and device
  ids stay on the server, and the page never gets a device stream.

## Run it

You need [Bun](https://bun.sh/), a Mobilerun API key and at least one Android
cloud phone in your organization.

```bash
cd examples/typescript/branded-assistant
bun install
cp .env.example .env   # set MOBILERUN_CLOUD_API_KEY and DEVICE_IDS
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). Each request runs a real
task and uses your organization's balance. The server binds to `127.0.0.1`.
Without an API key the page still loads, and requests are refused.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOBILERUN_CLOUD_API_KEY` | none | Server-side API key; never sent to the browser |
| `MOBILERUN_API_URL` | SDK default | API base URL; `/v1` is added when missing |
| `PORT` | `3000` | Listen port |
| `SESSION_SECRET` | random per start | Signs the session cookie; 32+ characters, required in production |
| `DEVICE_IDS` | none | Comma-separated cloud phone ids this app may use |
| `STARTING_BUDGET` | `100` | Credits a new user starts with |
| `RESERVE_PER_RUN` | `20` | Credits held while a request runs |
| `DATABASE_PATH` | `data/ledger.sqlite` | SQLite file for accounts and runs |

The persona, prompt and limits live in `assistant.json`; the presets and their
output schemas in `src/server/assistant.ts`. Neither the prompt, the model id
nor the schema ever reaches the browser.

## How it works

- **Start** (`POST /api/runs`): the server picks a free phone, then reserves
  `RESERVE_PER_RUN` credits in one SQL transaction that also checks the user
  has no other active run (`409 run_active`) and enough credits (`402`). Only
  then does it call `tasks.run`, with SDK retries off so a retry can never
  start the task twice. All phones busy answers `409 device_busy`.
- **Untrusted text**: the traveller's request and notes reach the agent inside
  `<traveller_request>` / `<traveller_message>` fences, with `<` and `>`
  escaped. The system prompt says fenced text and web pages are data, not
  instructions.
- **Unclear starts**: a 4xx (other than 408) means the task does not exist, so
  the reservation is refunded and the API's error is returned. On a timeout,
  408, 5xx or network error the task may exist: the run shows as *checking*,
  keeps its reservation and phone, and is settled in full at its deadline. If
  the task was accepted but its id could not be saved, the server keeps it in
  memory and records it on the next poll.
- **One watcher**: a server-side watcher polls `tasks.getStatus` every 3 s and
  records progress; `GET /api/runs/:id` only reads that record. A "Step N"
  entry is added only when the step count rises, and the page shows
  "Working… m:ss" from the run's start, because steps can stay at 0 for
  minutes. If the API cannot be reached, the run says so.
- **Notes**: while a run is active the traveller can send a note. If the API
  does not queue it (`sent: false`) the page shows an error and keeps the text.
- **Settle**: when the task ends, the watcher charges
  `min(ceil(creditsUsed), reserved)` and refunds the rest, once. Unknown usage
  charges the whole reservation. Past `executionTimeout` plus 60 s the run is
  stopped and settled the same way. The timeline is saved with the settlement.
- **Result**: output that matches the preset's schema becomes label/value
  rows; values the agent did not find are listed in one "Not found" line.
  Output that does not match is shown as text, never as a card. A failed task
  that carries the assistant's own words (for example, it declined) shows
  those words.
- **Ownership and restarts**: every run route filters by the session's user;
  another user's run answers `404`. A timed-out start in the browser re-reads
  the session and picks up a run that did start. After a restart, open runs
  get their phones back and are watched again; their timeline starts empty.
- **Errors**: this server's own refusals carry a code and plain text. API
  errors keep their status and text (for example `422` for an unavailable
  device type); map them to your own copy for a white-label product.

## What the Mobilerun API does not do for you

- **One org key.** There are no sub-accounts or per-end-user keys; your server
  holds the key and decides who may do what.
- **No metadata on tasks or devices.** The API does not know which user owns a
  task. This example keeps that mapping in its `runs` table.
- **No per-end-user billing.** Usage is billed to your organization. The
  ledger here is a *capped demo charge*: a user never pays more than the
  reservation, but your organization pays what the run really used, so set
  `RESERVE_PER_RUN` to cover the worst case of `maxSteps` and
  `executionTimeout`.
- **No "needs input" status.** The example does not guess when the agent is
  asking something; notes can be sent at any time while a run is active.

## Before production

- Replace the stub identity in `src/server/api-app.ts` with your own
  authentication. With the stub, clearing cookies gives a new user and a fresh
  budget.
- Do not hand device stream credentials to end users of a shared phone pool:
  the token outlives the run and lets its holder control the phone. Show the
  result instead, as this example does.
- Use dedicated phones with no operator accounts or saved credentials, and
  treat everything the agent returns as untrusted input. The fences reduce
  prompt injection; they do not remove it.
- Run one process, or move phone locks, the watcher and the ledger into a
  shared store first. Use a backed-up database and keep reserve and settle
  atomic in it.
- Keep `MOBILERUN_CLOUD_API_KEY` and `SESSION_SECRET` in a secret store, serve
  over HTTPS, and add rate limiting.

## Brand and design

`brand.json` holds the company, product name, tagline, accent colour and a
24×24 SVG path for the logo. `src/client/theme.css` is a small token-based
design system (light and dark), and `src/client/components/` has the app shell
and a phone frame (unused here). These files are shared verbatim with the
other white-label examples; page-specific styles live in `src/styles.css`.

## Verify

```bash
bun run check   # tests, typecheck, build
```

The tests fake the SDK, use an in-memory SQLite database and a hand-cranked
watcher clock, and never call the API.
