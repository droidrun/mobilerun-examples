"""Shared test fixtures."""

from __future__ import annotations

import hashlib
import hmac
from pathlib import Path

from mobilerun_webhook_receiver.config import Config

SECRET = "whsec_test"
NOW_MS = 1_800_000_000_000
FILE_ID = "3523498b-1053-44c2-9885-651491a49e7b"


def signature(body: bytes, timestamp: str = str(NOW_MS)) -> str:
    digest = hmac.new(
        SECRET.encode(),
        timestamp.encode() + b"." + body,
        hashlib.sha256,
    ).hexdigest()
    return f"sha256={digest}"


def signed_headers(
    body: bytes,
    *,
    timestamp: str | int,
    event_id: str = "event-1",
    event_type: str | None = None,
    signature_value: str | None = None,
) -> dict[str, str]:
    timestamp = str(timestamp)
    headers = {
        "X-Mobilerun-Timestamp": timestamp,
        "X-Mobilerun-Signature": (
            signature(body, timestamp) if signature_value is None else signature_value
        ),
        "X-Mobilerun-Event-Id": event_id,
    }
    if event_type is not None:
        headers["X-Mobilerun-Event-Type"] = event_type
    return headers


def config(download_dir: Path) -> Config:
    return Config(
        host="127.0.0.1",
        port=3000,
        webhook_path="/mobilerun/abcdefghijklmnopqrstuvwxyz",
        webhook_secret=SECRET,
        api_base_url="https://api.mobilerun.ai/v1",
        api_key="dr_sk_test",
        download_dir=download_dir,
        max_body_bytes=65_536,
        max_file_bytes=1024,
        max_timestamp_age_ms=300_000,
    )


class FakeDownloader:
    def __init__(self, destination: Path):
        self.destination = destination
        self.calls = 0

    def download(self, _file_data):
        self.calls += 1
        return self.destination
