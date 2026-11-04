---
name: mobilerun-branded-assistant
description: Build, run, test, or adapt a white-label assistant that runs Mobilerun tasks on a phone behind your own brand, persona, user sessions, and per-user credit budget. Use for tasks.run with a system prompt and output schema, progress polling, notes via tasks.sendMessage, credit reserve/settle, own run ids, or the bundled Bun, Hono, and React branded-assistant example. Do not use for the basic task runner, Python webhook receivers, or direct browser-side Mobilerun API calls.
---

# Mobilerun branded assistant

Use the repository's runnable
[branded assistant](../../examples/typescript/branded-assistant/) as the source
of truth. Resolve this link relative to this `SKILL.md`. The basic task flow
lives in [`mobilerun-task-runner`](../mobilerun-task-runner/); this skill covers
what a white-label product adds on top of it.

## Workflow

1. Read the example's
   [`README.md`](../../examples/typescript/branded-assistant/README.md),
   [`assistant.json`](../../examples/typescript/branded-assistant/assistant.json),
   [`brand.json`](../../examples/typescript/branded-assistant/brand.json), and
   [`.env.example`](../../examples/typescript/branded-assistant/.env.example).
2. Adapt the persona, prompt and limits in `assistant.json`, and the presets
   (each with a zod output schema) in `src/server/assistant.ts`.
3. To rebrand, edit `brand.json`. `src/client/theme.css`, `src/client/brand.ts`
   and `src/client/components/{app-shell,phone-frame}.tsx` are shared verbatim
   with the other white-label examples; keep them generic and put page styles
   in `src/styles.css`.
4. Every SDK call, the watcher and settlement live in
   `src/server/assistant-service.ts`; the ledger in `src/server/ledger.ts`.
   Tests fake the SDK client and use an in-memory SQLite database.
5. Replace the stub identity in `src/server/api-app.ts` with real
   authentication before any shared deployment; the routes only read the user
   id. With the stub, clearing cookies resets the budget.
6. For offline work run `bun run check` in the example directory. Do not start a
   real task unless the user explicitly asks; say that it consumes organization
   credits.

## Required boundaries

- Keep `MOBILERUN_CLOUD_API_KEY` on the server. The browser receives only the
  narrow run view: no task ids, device ids, prompts, model ids or schemas.
- Never send device stream credentials (`streamUrl`, `streamToken`) to end users
  of a shared phone pool: the token outlives the run and is not scoped to it.
- Do not accept privileged task options from the browser. Fence user text sent
  to the agent (`<traveller_request>`, `<traveller_message>`), escape angle
  brackets inside it, and tell the system prompt the fence is untrusted data.
- Reserve credits atomically before `tasks.run()` (one active run per user),
  create the account row only on the first reservation, and settle once with
  `min(ceil(creditsUsed), reserved)`. Unknown usage charges the whole
  reservation; `RESERVE_PER_RUN` must cover the worst case.
- Call `tasks.run()` with `maxRetries: 0`. Refund only on a definite 4xx other
  than 408. On timeouts, 408, 5xx and network errors keep the reservation and
  the phone, and let the watcher reconcile or expire the run.
- Let one server-side watcher poll and settle; routes only read its record.
  Past `executionTimeout` plus a margin, stop the task, settle, free the phone.
- Validate task output with the preset's zod schema; show unreadable output as
  text, never as a card. Surface `sendMessage` returning `sent: false`.
- Keep the API's status for its errors; map its text to your own copy for a
  white-label product. Add no client-side gates for devices, quotas or
  permissions the server decides.
- One active run per phone and one process: the locks and the watcher are in
  memory. Only use `android_cloud_phone` devices. Do not mention Mobilerun in
  end-user UI copy.

After changes, run `bun run check` from the example directory.
