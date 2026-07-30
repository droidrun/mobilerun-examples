---
name: mobilerun-webhooks
description: Build, run, and troubleshoot signed mobilerun webhook receivers in Python using the published mobilerun-sdk package. Use when verifying HMAC webhook headers, handling retries or replays, or securely downloading files referenced by workflow webhook events.
---

# mobilerun webhooks

Use the runnable implementation in
`examples/python/webhook-file-receiver/` as the source of truth. Preserve its
authentication and download safeguards when adapting it.

Keep responsibilities separated across `config.py`, `security.py`,
`downloader.py`, `application.py`, and `http_server.py`. Keep `receiver.py` as
the minimal executable entry point.

## Workflow

1. Inspect `pyproject.toml` and keep `mobilerun-sdk` installed from PyPI. Do
   not add a local editable source override.
2. Read the example README and `.env.example`. Use the SDK's canonical
   `MOBILERUN_CLOUD_API_KEY` and `MOBILERUN_BASE_URL` variables.
3. Configure a long random `WEBHOOK_PATH` and the endpoint's signing secret in
   `WEBHOOK_SECRET`.
4. Start the receiver and, for local callbacks, an HTTPS tunnel such as ngrok.
5. Send or trigger a real webhook and confirm a verified event and an
   atomically saved file under `DOWNLOAD_DIR`.

## Required security properties

- Verify the HMAC against the exact raw body and
  `X-Mobilerun-Timestamp`; never reserialize JSON before verification.
- Use constant-time comparison and reject stale timestamps.
- Match the signed event ID/type to their headers and deduplicate event IDs.
- Validate `downloadPath`, `fileId`, filename, declared size, and streamed size.
- Use the authenticated SDK client only for the mobilerun API request.
- Follow the presigned storage redirect without an `Authorization` header.
- Write to a temporary file and atomically rename only after validation.
- Return 5xx for transient download failures so mobilerun can retry.
- Never print or commit API keys, signing secrets, or presigned URLs.

## SDK usage

The file-content route is not a modeled SDK resource, so call the
`mobilerun_sdk.Mobilerun` client's public
`get(..., cast_to=httpx.Response, stream=True)` method for the authenticated API
hop. Handle a presigned storage redirect with a separate unauthenticated
`httpx.Client`.

Run the unit tests and the skill validator after changes. Do not make live API
changes unless the user explicitly asks to modify a real endpoint or workflow.
