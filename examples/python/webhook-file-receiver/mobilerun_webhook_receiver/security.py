"""Webhook authentication and replay protection."""

from __future__ import annotations

import hashlib
import hmac
import threading
import time

from .errors import PayloadError

SIGNATURE_HEADER = "X-Mobilerun-Signature"
TIMESTAMP_HEADER = "X-Mobilerun-Timestamp"
EVENT_ID_HEADER = "X-Mobilerun-Event-Id"
EVENT_TYPE_HEADER = "X-Mobilerun-Event-Type"


def verify_signature(
    raw_body: bytes,
    timestamp: str,
    signature: str,
    secret: bytes,
    *,
    now_ms: int | None = None,
    max_age_ms: int = 300_000,
) -> None:
    """Verify timestamp freshness and HMAC over ``timestamp.raw_body``."""
    try:
        timestamp_ms = int(timestamp)
        timestamp_bytes = timestamp.encode("ascii")
    except (TypeError, ValueError, UnicodeEncodeError) as exc:
        raise PayloadError("invalid timestamp") from exc

    current_ms = int(time.time() * 1000) if now_ms is None else now_ms
    if abs(current_ms - timestamp_ms) > max_age_ms:
        raise PayloadError("stale timestamp")

    expected = (
        "sha256="
        + hmac.new(
            secret,
            timestamp_bytes + b"." + raw_body,
            hashlib.sha256,
        ).hexdigest()
    )
    if not hmac.compare_digest(expected, signature):
        raise PayloadError("invalid signature")


class EventDeduper:
    """Thread-safe, bounded in-memory claim set for replay protection."""

    def __init__(self, *, ttl_seconds: int = 86_400, max_entries: int = 10_000):
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()

    def claim(self, event_id: str) -> bool:
        now = time.monotonic()
        with self._lock:
            self._prune(now)
            if event_id in self._seen:
                return False
            if len(self._seen) >= self.max_entries:
                oldest = min(self._seen, key=self._seen.__getitem__)
                del self._seen[oldest]
            self._seen[event_id] = now + self.ttl_seconds
            return True

    def discard(self, event_id: str) -> None:
        """Release a failed event so a mobilerun retry can process it."""
        with self._lock:
            self._seen.pop(event_id, None)

    def _prune(self, now: float) -> None:
        expired = [key for key, expiry in self._seen.items() if expiry <= now]
        for key in expired:
            del self._seen[key]
