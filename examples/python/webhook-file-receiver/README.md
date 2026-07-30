# Signed webhook receiver with file download

This web server receives mobilerun webhook events, verifies their HMAC
authentication, and downloads a referenced workflow file through
`mobilerun_sdk.Mobilerun`.

It uses two independent credentials:

1. `WEBHOOK_SECRET` verifies that the exact callback body came from mobilerun.
2. `MOBILERUN_CLOUD_API_KEY` authenticates the referenced file download.

## Security behavior

The receiver:

- verifies `HMAC-SHA256(secret, "<timestamp>.<raw-body>")` in constant time;
- rejects stale requests and replayed event IDs;
- matches the signed event ID and type to the request headers;
- validates the file ID, download path, filename, and size;
- streams the download to a temporary file and renames it atomically;
- never forwards the mobilerun bearer token to presigned object storage;
- returns 5xx after download failures so mobilerun can retry.

The replay cache is in memory for this single-process example. Use Redis or a
database with a unique event-ID constraint when running multiple instances.

## Requirements

- Python 3.11+
- [uv](https://docs.astral.sh/uv/)
- a mobilerun API key and webhook signing secret
- ngrok only when exposing the local server publicly

## Install

From the `mobilerun-examples` repository root:

```bash
uv sync
```

The focused
[`mobilerun-sdk`](https://pypi.org/project/mobilerun-sdk/) package is installed
from PyPI and supplies `mobilerun_sdk` without pulling in the full automation
runtime.

## Project layout

```text
receiver.py                         # minimal executable entry point
mobilerun_webhook_receiver/
  config.py                         # environment validation
  security.py                       # HMAC and replay protection
  downloader.py                     # SDK request and atomic file storage
  application.py                    # webhook event processing
  http_server.py                    # HTTP transport
```

The layers are composed through small interfaces, so authentication, download,
and event handling can be tested independently.

## Configure

```bash
cd examples/python/webhook-file-receiver
cp .env.example .env
```

Set these values in `.env`:

```dotenv
MOBILERUN_BASE_URL=https://api.mobilerun.ai/v1
MOBILERUN_CLOUD_API_KEY=dr_sk_...
WEBHOOK_PATH=/mobilerun/a-long-random-private-path
WEBHOOK_SECRET=whsec_...
DOWNLOAD_DIR=./downloads
```

`WEBHOOK_SECRET` is the one-time secret returned when the webhook endpoint is
created; it is not the API key or the private URL path.

## Run the server

Load the environment and start the receiver:

```bash
set -a
source .env
set +a
uv run python receiver.py
```

It listens on `127.0.0.1:3000` by default. For a local callback, expose it with:

```bash
ngrok http 3000
```

Configure the webhook endpoint URL as the ngrok HTTPS origin followed by
`WEBHOOK_PATH`.

When a verified `workflow.step.emit` event contains `data.file`, the file is
saved under `DOWNLOAD_DIR` as:

```text
<file-id>--<original-filename>
```

## Expected file payload

```json
{
  "id": "event-uuid",
  "type": "workflow.step.emit",
  "data": {
    "file": {
      "fileId": "3523498b-1053-44c2-9885-651491a49e7b",
      "filename": "result.csv",
      "mimeType": "text/csv",
      "sizeBytes": 1066,
      "downloadPath": "/v1/agents/files/3523498b-1053-44c2-9885-651491a49e7b/download"
    }
  }
}
```

Required authentication headers:

```text
X-Mobilerun-Event-Id
X-Mobilerun-Event-Type
X-Mobilerun-Timestamp
X-Mobilerun-Signature: sha256=<hex>
```

## Run tests

From the repository root:

```bash
uv run python -m unittest discover \
  -s examples/python/webhook-file-receiver/tests \
  -p 'test_*.py' -v
```
