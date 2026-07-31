"""Webhook event validation and processing."""

from __future__ import annotations

import json
from collections.abc import Mapping
from http import HTTPStatus
from pathlib import Path
from typing import Any, Protocol

from .config import Config
from .downloader import MobilerunFileDownloader
from .errors import DownloadError, PayloadError
from .security import (
    EVENT_ID_HEADER,
    EVENT_TYPE_HEADER,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    EventDeduper,
    verify_signature,
)


class Downloader(Protocol):
    def download(self, file_data: Mapping[str, Any]) -> Path: ...


class WebhookApplication:
    def __init__(
        self,
        config: Config,
        *,
        downloader: Downloader | None = None,
        deduper: EventDeduper | None = None,
    ):
        self.config = config
        self.downloader = downloader or MobilerunFileDownloader(config)
        self.deduper = deduper or EventDeduper()

    def handle(
        self,
        headers: Mapping[str, str],
        raw_body: bytes,
    ) -> tuple[int, dict[str, Any]]:
        auth_error = self._authenticate(headers, raw_body)
        if auth_error:
            return auth_error

        event_id = _header(headers, EVENT_ID_HEADER)
        event = self._parse_event(headers, raw_body, event_id)
        if isinstance(event, tuple):
            return event
        if not self.deduper.claim(event_id):
            return HTTPStatus.OK, {
                "message": "duplicate ignored",
                "eventId": event_id,
            }
        return self._process(event_id, event)

    def _authenticate(
        self,
        headers: Mapping[str, str],
        raw_body: bytes,
    ) -> tuple[int, dict[str, Any]] | None:
        try:
            verify_signature(
                raw_body,
                _header(headers, TIMESTAMP_HEADER),
                _header(headers, SIGNATURE_HEADER),
                self.config.webhook_secret,
                max_age_ms=self.config.max_timestamp_age_ms,
            )
        except PayloadError as exc:
            return HTTPStatus.UNAUTHORIZED, {"message": str(exc)}
        return None

    @staticmethod
    def _parse_event(
        headers: Mapping[str, str],
        raw_body: bytes,
        event_id: str,
    ) -> dict[str, Any] | tuple[int, dict[str, Any]]:
        if not event_id:
            return HTTPStatus.BAD_REQUEST, {"message": "missing event id"}
        try:
            event = json.loads(raw_body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return HTTPStatus.BAD_REQUEST, {"message": "invalid JSON"}
        if not isinstance(event, dict):
            return HTTPStatus.BAD_REQUEST, {"message": "event must be an object"}
        if event.get("id") != event_id:
            return HTTPStatus.BAD_REQUEST, {"message": "event id mismatch"}
        event_type = _header(headers, EVENT_TYPE_HEADER)
        if event_type and event.get("type") != event_type:
            return HTTPStatus.BAD_REQUEST, {"message": "event type mismatch"}
        return event

    def _process(
        self,
        event_id: str,
        event: Mapping[str, Any],
    ) -> tuple[int, dict[str, Any]]:
        result: dict[str, Any] = {
            "message": "accepted",
            "eventId": event_id,
            "type": event.get("type"),
        }
        try:
            file_data = self._file_data(event)
            if file_data is not None:
                self.downloader.download(file_data)
                result["file"] = {
                    "fileId": file_data.get("fileId"),
                    "filename": file_data.get("filename"),
                }
        except PayloadError as exc:
            self.deduper.discard(event_id)
            return HTTPStatus.BAD_REQUEST, {"message": str(exc)}
        except DownloadError as exc:
            self.deduper.discard(event_id)
            return HTTPStatus.BAD_GATEWAY, {"message": str(exc)}
        except Exception:
            self.deduper.discard(event_id)
            raise

        print(
            json.dumps(
                {
                    "eventId": event_id,
                    "type": event.get("type"),
                    "message": "accepted",
                }
            ),
            flush=True,
        )
        return HTTPStatus.OK, result

    @staticmethod
    def _file_data(event: Mapping[str, Any]) -> Mapping[str, Any] | None:
        data = event.get("data")
        if data is None:
            return None
        if not isinstance(data, dict):
            raise PayloadError("event.data must be an object")
        file_data = data.get("file")
        if file_data is None:
            return None
        if not isinstance(file_data, dict):
            raise PayloadError("event.data.file must be an object")
        return file_data


def _header(headers: Mapping[str, str], name: str) -> str:
    """Read an HTTP header without depending on its wire-case spelling."""
    wanted = name.casefold()
    for key, value in headers.items():
        if key.casefold() == wanted:
            return value
    return ""
