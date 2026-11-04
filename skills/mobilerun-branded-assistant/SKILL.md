---
name: mobilerun-branded-assistant
description: Build, run, test, or adapt a white-label assistant that runs Mobilerun tasks on a phone behind your own brand, persona, user sessions, and per-user credit budget. Use for tasks.run with a system prompt and output schema, progress polling, notes via tasks.sendMessage, credit reserve/settle, own run ids, or the bundled Bun, Hono, and React branded-assistant example. Do not use for the basic task runner, Python webhook receivers, or direct browser-side Mobilerun API calls.
---

# Mobilerun branded assistant

Use the repository's runnable
[branded assistant](../../examples/typescript/branded-assistant/) as the source
of truth. Resolve this link relative to this `SKILL.md`. The basic task and
stream flow lives in [`mobilerun-task-runner`](../mobilerun-task-runner/); this
skill covers what a white-label product adds on top of it.

## Workflow

1. Read the example's
   [`README.md`](../../examples/typescript/branded-assistant/README.md),
   [`assistant.json`](../../examples/typescript/branded-assistant/assistant.json),
   [`brand.json`](../../examples/typescript/branded-assistant/brand.json), and
   [`.env.example`](../../examples/typescript/branded-assistant/.env.example).
2. Adapt the brand and persona by editing `brand.json`, `assistant.json`
   (display name, tone, system prompt, step and time limits) and
   `src/server/presets.ts` (presets with a zod output schema each).
3. Replace the stub identity in `src/server/session.ts` with real
   authentication before any shared deployment. Keep the rest of the server
   reading only the user id. With the stub, clearing cookies resets the budget.
4. Keep SDK calls in `src/server/mobilerun-adapter.ts`; SDK errors pass through
   and routes read `error.status`. Tests use a fake adapter and an in-memory
   SQLite database.
5. For offline work run `bun run check` in the example directory. Do not start a
   real task or phone session unless the user explicitly asks; say that it
   consumes organization credits.

## Required boundaries

- Keep `MOBILERUN_CLOUD_API_KEY` on the server. The browser receives only the
  narrow run view.
- Never send device stream credentials (`streamUrl`, `streamToken`) to end users
  of a shared phone pool: the token outlives the run and is not scoped to it.
- Keep the system prompt, tone, model id, and output schema on the server. Do
  not accept them, or any other privileged task option, from the browser.
- Fence user text sent to the agent (`<traveller_request>`,
  `<traveller_message>`), escape angle brackets inside it, and tell the system
  prompt the fence is untrusted data. Use phones without operator accounts.
- Expose your own run ids. Mobilerun task ids stay server-side, and every run
  route filters by the signed-in user (another user's id answers `404`).
- Mobilerun has one organization key, no sub-accounts, no per-end-user keys, no
  metadata or tags on devices or tasks, and no per-end-user billing. Keep users,
  budgets, and the task-to-user mapping in your own database.
- Reserve credits atomically before `tasks.run()` (one active run per user),
  create the account row only on the first reservation, and settle once with
  `min(creditsUsed, reserved)`. Unknown usage charges the whole reservation.
  `RESERVE_PER_RUN` must cover the worst case; the operator pays any overage.
- Call `tasks.run()` with `maxRetries: 0`. Refund only on a definite 4xx
  rejection. On timeouts, 5xx and network errors keep the reservation and the
  phone, and let the watcher reconcile or expire the run.
- Let one server-side watcher poll and settle; routes only read its record.
  Past `executionTimeout` plus a margin, stop the task, settle, free the phone.
- Validate task output with the preset's zod schema; show unreadable output as
  such, never as a card.
- Render upstream API errors (4xx/422, such as an unavailable device or an
  insufficient balance) as returned. Do not add client-side gates for devices,
  quotas, or permissions the API already decides.
- One active run per phone, and one process: the locks and the watcher are in
  memory. Only use `android_cloud_phone` devices. Do not mention Mobilerun in
  end-user UI copy.

## Architecture

- `src/server/assistant-service.ts`: reserve → start, notes, cancel, sessions;
- `src/server/run-watcher.ts`: the one polling path: progress, settlement,
  deadlines, phone release;
- `src/server/ledger.ts`: SQLite accounts and runs, atomic reserve and settle;
- `src/server/presets.ts` and `assistant-config.ts`: presets with zod output
  schemas, `assistant.json` validation, prompt fencing;
- `src/server/api-app.ts`: validation, CSRF, ownership, error mapping;
- `src/client/use-assistant.ts` and `conversation-machine.ts`: serial polling
  and the pure conversation reducer.

After changes, run `bun run check` from the example directory.
