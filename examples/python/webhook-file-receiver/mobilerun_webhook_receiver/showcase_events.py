"""Bounded in-memory event fan-out for the local showcase."""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any


class EventHub:
    """Keep a small replay buffer and wake connected SSE clients."""

    def __init__(self, maximum: int = 100) -> None:
        self._events: deque[dict[str, Any]] = deque(maxlen=maximum)
        self._sequence = 0
        self._condition = threading.Condition()

    def publish(self, event: dict[str, Any]) -> dict[str, Any]:
        with self._condition:
            self._sequence += 1
            record = {
                "sequence": self._sequence,
                "receivedAt": int(time.time() * 1000),
                **event,
            }
            self._events.appendleft(record)
            self._condition.notify_all()
            return record

    def snapshot(self) -> list[dict[str, Any]]:
        with self._condition:
            return list(self._events)

    def wait_after(self, sequence: int, timeout: float = 15) -> list[dict[str, Any]]:
        with self._condition:
            self._condition.wait_for(
                lambda: self._sequence > sequence,
                timeout=timeout,
            )
            return [
                event
                for event in reversed(self._events)
                if event["sequence"] > sequence
            ]
