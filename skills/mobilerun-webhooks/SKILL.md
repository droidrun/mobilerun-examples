---
name: mobilerun-webhooks
description: Build, run, test, or troubleshoot Python receivers for signed Mobilerun webhooks using the published mobilerun-sdk package. Use for SDK signature verification, webhook retries and replay protection, secure downloads of files referenced by workflow events, or the bundled webhook showcase. Do not use for general Mobilerun tasks, outbound workflow configuration without a receiving webhook, or TypeScript task-runner integrations.
---

# Mobilerun webhooks

Use the repository's runnable
[Python webhook receiver](../../examples/python/webhook-file-receiver/) as the
source of truth. Resolve this link relative to this `SKILL.md`, even when the
current working directory is elsewhere. Preserve its authentication and
download safeguards when adapting it.

Keep responsibilities separated across `config.py`, `security.py`,
`downloader.py`, `application.py`, and `http_server.py`. Keep `receiver.py` as
the minimal executable entry point.

## Workflow

1. Inspect the repository-root [`pyproject.toml`](../../pyproject.toml) and keep
   `mobilerun-sdk` installed from PyPI. Do not add a local editable source
   override.
2. Read the receiver's [`README.md`](../../examples/python/webhook-file-receiver/README.md)
   and [`.env.example`](../../examples/python/webhook-file-receiver/.env.example).
   Use `MOBILERUN_API_KEY` and `MOBILERUN_BASE_URL` exactly as shown.
3. Configure a long random `WEBHOOK_PATH` and the endpoint's signing secret in
   `WEBHOOK_SECRET`.
4. For offline work, run the tests and stop there. Do not create or modify a
   real webhook endpoint or workflow.
5. Only when the user explicitly requests live verification, start the
   receiver and an HTTPS tunnel, create or configure the endpoint, trigger a
   real webhook, and confirm a verified event and an atomically saved file
   under `DOWNLOAD_DIR`.

## Required security properties

- Pass the exact raw body and request headers to `verify_webhook` from
  `mobilerun_sdk`, with the signing secret and configured freshness tolerance
  in seconds. The SDK verifies signatures and timestamps before parsing JSON;
  never reserialize the body before verification.
- Map `WebhookVerificationError` to HTTP 401 using its reason. The
  `invalid_json` reason maps to HTTP 400; see the receiver README for SDK
  compatibility.
- Match the signed event ID/type to their headers and deduplicate event IDs.
- Validate `downloadPath`, `fileId`, filename, declared size, and streamed size.
- Use the authenticated SDK client only for the mobilerun API request.
- Follow the presigned storage redirect without an `Authorization` header.
- Write to a temporary file and atomically rename only after validation.
- Return 5xx for transient download failures so mobilerun can retry.
- Never print or commit API keys, signing secrets, or presigned URLs.

## SDK usage

Use `mobilerun_sdk.MobilerunSDK` for webhook and workflow object handles.
For file downloads, call `MobilerunSDK(...).api.get(...,
cast_to=httpx.Response, stream=True)` for the authenticated API hop. The SDK's
file download helper buffers the body; streaming preserves the receiver's size
cap. Handle the presigned storage redirect with a separate unauthenticated
`httpx.Client`, so the API token never reaches storage.

After changes, run the repository check from the repository root and run the
skill validator when it is available. Never make live API changes unless the
user explicitly asks to modify or verify a real endpoint or workflow.
