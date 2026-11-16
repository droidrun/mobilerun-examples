"""Replay protection and event header names."""

from __future__ import annotations

import threading
import time

EVENT_ID_HEADER = "X-Mobilerun-Event-Id"
EVENT_TYPE_HEADER = "X-Mobilerun-Event-Type"


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
