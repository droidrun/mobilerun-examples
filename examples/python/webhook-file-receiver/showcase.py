#!/usr/bin/env python3
"""Run the interactive workflow and webhook file-download showcase."""

from __future__ import annotations

import hmac
import json
import mimetypes
import os
import secrets
import signal
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlsplit
from uuid import UUID

from mobilerun_sdk import Mobilerun
from mobilerun_webhook_receiver.application import WebhookApplication
from mobilerun_webhook_receiver.config import Config
from mobilerun_webhook_receiver.showcase_events import EventHub

ROOT = Path(__file__).resolve().parent
DASHBOARD = (ROOT / "showcase.html").read_bytes()
STYLESHEET = (ROOT / "showcase.css").read_bytes()
JAVASCRIPT = (ROOT / "showcase.js").read_bytes()
SESSION_COOKIE = "mobilerun_showcase_session"
TEXT_PREVIEW_MIME_TYPES = {
    "application/csv",
    "application/json",
    "application/xml",
}


def as_json(value: Any) -> Any:
    """Convert Stainless/Pydantic SDK responses to plain JSON values."""
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return value


def positive_int(env: Mapping[str, str], name: str, default: int) -> int:
    try:
        value = int(env.get(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def boolean(env: Mapping[str, str], name: str, default: bool) -> bool:
    value = env.get(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be true or false")


@dataclass(frozen=True)
class ShowcaseSettings:
    public_url: str
    api_base_url: str
    api_key: str
    host: str
    port: int
    download_dir: Path
    access_token: str
    trigger_id: str | None
    preview_max_bytes: int
    webhook_id: str | None
    webhook_path: str | None
    webhook_secret: str | None
    delete_webhook_on_exit: bool

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> ShowcaseSettings:
        values = os.environ if env is None else env
        public_url = values.get("PUBLIC_URL", "").rstrip("/")
        parsed = urlsplit(public_url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("PUBLIC_URL must be an HTTPS origin")

        api_key = values.get("MOBILERUN_CLOUD_API_KEY", "")
        if not api_key:
            raise ValueError("MOBILERUN_CLOUD_API_KEY is required")

        trigger_id = values.get("SHOWCASE_TRIGGER_ID") or None
        if trigger_id:
            trigger_id = str(UUID(trigger_id))

        webhook_id = values.get("SHOWCASE_WEBHOOK_ID") or None
        webhook_path = values.get("SHOWCASE_WEBHOOK_PATH") or None
        webhook_secret = values.get("SHOWCASE_WEBHOOK_SECRET") or None
        supplied = (webhook_id, webhook_path, webhook_secret)
        if any(supplied) and not all(supplied):
            raise ValueError(
                "SHOWCASE_WEBHOOK_ID, SHOWCASE_WEBHOOK_PATH, and "
                "SHOWCASE_WEBHOOK_SECRET must be set together"
            )
        if webhook_id:
            webhook_id = str(UUID(webhook_id))
            if not webhook_path.startswith("/") or len(webhook_path) < 24:
                raise ValueError(
                    "SHOWCASE_WEBHOOK_PATH must start with '/' and contain "
                    "at least 24 characters"
                )

        return cls(
            public_url=public_url,
            api_base_url=values.get(
                "MOBILERUN_BASE_URL", "https://api.mobilerun.ai/v1"
            ).rstrip("/"),
            api_key=api_key,
            host=values.get("HOST", "127.0.0.1"),
            port=positive_int(values, "PORT", 3000),
            download_dir=Path(values.get("DOWNLOAD_DIR", str(ROOT / "downloads"))),
            access_token=(
                values.get("SHOWCASE_ACCESS_TOKEN") or secrets.token_urlsafe(32)
            ),
            trigger_id=trigger_id,
            preview_max_bytes=positive_int(
                values, "SHOWCASE_PREVIEW_MAX_BYTES", 100_000
            ),
            webhook_id=webhook_id,
            webhook_path=webhook_path,
            webhook_secret=webhook_secret,
            delete_webhook_on_exit=boolean(
                values, "SHOWCASE_DELETE_WEBHOOK_ON_EXIT", True
            ),
        )


class Showcase:
    def __init__(
        self,
        settings: ShowcaseSettings,
        config: Config,
        client: Mobilerun,
        webhook_id: str,
    ) -> None:
        self.settings = settings
        self.config = config
        self.client = client
        self.webhook_id = webhook_id
        self.receiver = WebhookApplication(config)
        self.events = EventHub()

    @property
    def webhook_url(self) -> str:
        return f"{self.settings.public_url}{self.config.webhook_path}"

    def triggers(self) -> list[dict[str, Any]]:
        if self.settings.trigger_id:
            response = self.client.workflows.triggers.retrieve(self.settings.trigger_id)
            payload = as_json(response).get("data", {})
            items = [payload]
        else:
            response = self.client.workflows.triggers.list(
                activation="custom",
                page_size=100,
            )
            items = as_json(response).get("items", [])

        return [
            {
                "id": item["id"],
                "name": item["name"],
                "description": item.get("description"),
                "schema": item.get("custom_payload_schema")
                or item.get("customPayloadSchema"),
            }
            for item in items
        ]

    def start_workflow(
        self,
        trigger_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        trigger_id = str(UUID(trigger_id))
        if self.settings.trigger_id and trigger_id != self.settings.trigger_id:
            raise ValueError("trigger is not enabled for this showcase")
        response = self.client.workflows.triggers.fire(
            trigger_id,
            payload=payload,
        )
        return as_json(response)

    def downloaded_file(self, file_id: str) -> Path | None:
        canonical = str(UUID(file_id))
        matches = list(self.config.download_dir.glob(f"{canonical}--*"))
        if len(matches) != 1 or not matches[0].is_file():
            return None
        return matches[0]

    def preview(self, file_data: Mapping[str, Any]) -> str | None:
        mime_type = file_data.get("mimeType")
        if not isinstance(mime_type, str) or not (
            mime_type.startswith("text/") or mime_type in TEXT_PREVIEW_MIME_TYPES
        ):
            return None
        path = self.downloaded_file(str(file_data.get("fileId", "")))
        if path is None or path.stat().st_size > self.settings.preview_max_bytes:
            return None
        return path.read_text(encoding="utf-8", errors="replace")


def make_handler(showcase: Showcase):
    class Handler(BaseHTTPRequestHandler):
        server_version = "mobilerun-showcase/1"

        def do_GET(self) -> None:
            path = urlsplit(self.path).path
            if path == "/":
                self._bytes(HTTPStatus.OK, DASHBOARD, "text/html; charset=utf-8")
                return
            if path == "/showcase.css":
                self._bytes(HTTPStatus.OK, STYLESHEET, "text/css; charset=utf-8")
                return
            if path == "/showcase.js":
                self._bytes(
                    HTTPStatus.OK,
                    JAVASCRIPT,
                    "text/javascript; charset=utf-8",
                )
                return
            if not self._authorized():
                self._json(HTTPStatus.UNAUTHORIZED, {"message": "unauthorized"})
                return
            if path == "/api/config":
                self._json(
                    HTTPStatus.OK,
                    {
                        "publicUrl": showcase.settings.public_url,
                        "webhookUrl": showcase.webhook_url,
                        "webhookId": showcase.webhook_id,
                    },
                )
            elif path == "/api/triggers":
                self._sdk_call(lambda: {"items": showcase.triggers()})
            elif path == "/api/events":
                self._json(
                    HTTPStatus.OK,
                    {"items": showcase.events.snapshot()},
                )
            elif path == "/api/events/stream":
                self._event_stream()
            elif path.startswith("/api/downloads/"):
                self._download(unquote(path.removeprefix("/api/downloads/")))
            else:
                self._json(HTTPStatus.NOT_FOUND, {"message": "not found"})

        def do_POST(self) -> None:
            path = urlsplit(self.path).path
            if path == showcase.config.webhook_path:
                self._webhook()
                return
            if path == "/api/session":
                self._create_session()
                return
            if not self._authorized():
                self._json(HTTPStatus.UNAUTHORIZED, {"message": "unauthorized"})
                return
            if path == "/api/workflows/start":
                self._start_workflow()
            else:
                self._json(HTTPStatus.NOT_FOUND, {"message": "not found"})

        def _create_session(self) -> None:
            raw = self._read_body(4_096)
            if raw is None:
                return
            try:
                token = json.loads(raw).get("token", "")
            except (AttributeError, UnicodeDecodeError, json.JSONDecodeError):
                token = ""
            if not isinstance(token, str) or not hmac.compare_digest(
                token,
                showcase.settings.access_token,
            ):
                self._json(HTTPStatus.UNAUTHORIZED, {"message": "unauthorized"})
                return
            self._json(
                HTTPStatus.NO_CONTENT,
                {},
                extra_headers={
                    "Set-Cookie": (
                        f"{SESSION_COOKIE}={showcase.settings.access_token}; "
                        "Path=/; Max-Age=43200; Secure; HttpOnly; SameSite=Strict"
                    )
                },
            )

        def _authorized(self) -> bool:
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            supplied = cookie.get(SESSION_COOKIE)
            return supplied is not None and hmac.compare_digest(
                supplied.value,
                showcase.settings.access_token,
            )

        def _webhook(self) -> None:
            raw = self._read_body(showcase.config.max_body_bytes)
            if raw is None:
                return
            headers = {key: value for key, value in self.headers.items()}
            status, response = showcase.receiver.handle(headers, raw)
            try:
                payload = json.loads(raw)
            except (UnicodeDecodeError, json.JSONDecodeError):
                payload = None

            if HTTPStatus.OK <= status < HTTPStatus.MULTIPLE_CHOICES:
                result_file = (
                    response.get("file") if isinstance(response, dict) else None
                )
                event_file = None
                if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
                    candidate = payload["data"].get("file")
                    if isinstance(candidate, dict):
                        event_file = candidate
                showcase.events.publish(
                    {
                        "status": int(status),
                        "event": payload,
                        "result": response,
                        "downloadUrl": (
                            f"/api/downloads/{result_file['fileId']}"
                            if isinstance(result_file, dict)
                            else None
                        ),
                        "fileContent": (
                            showcase.preview(event_file)
                            if event_file is not None and result_file is not None
                            else None
                        ),
                    }
                )
            self._json(status, response)

        def _start_workflow(self) -> None:
            raw = self._read_body(65_536)
            if raw is None:
                return
            try:
                body = json.loads(raw)
                trigger_id = body["triggerId"]
                payload = body.get("payload", {})
                if not isinstance(trigger_id, str) or not isinstance(payload, dict):
                    raise TypeError("triggerId and object payload are required")
                result = showcase.start_workflow(trigger_id, payload)
            except (KeyError, ValueError, json.JSONDecodeError) as exc:
                self._json(
                    HTTPStatus.BAD_REQUEST,
                    {"message": str(exc) or "invalid request"},
                )
                return
            except Exception:  # noqa: BLE001 - hide SDK details from the browser
                self._json(
                    HTTPStatus.BAD_GATEWAY,
                    {"message": "mobilerun API request failed"},
                )
                return
            self._json(HTTPStatus.ACCEPTED, result)

        def _event_stream(self) -> None:
            self.send_response(HTTPStatus.OK)
            self._security_headers()
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            sequence = 0
            try:
                while True:
                    events = showcase.events.wait_after(sequence)
                    if not events:
                        self.wfile.write(b": keepalive\n\n")
                    for event in events:
                        sequence = event["sequence"]
                        data = json.dumps(event, separators=(",", ":")).encode()
                        self.wfile.write(b"event: webhook\ndata: " + data + b"\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return

        def _download(self, file_id: str) -> None:
            try:
                path = showcase.downloaded_file(file_id)
            except ValueError:
                path = None
            if path is None:
                self._json(HTTPStatus.NOT_FOUND, {"message": "file not found"})
                return
            content_type = (
                mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            )
            original_name = path.name.split("--", 1)[-1].replace('"', "")
            body = path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self._security_headers()
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header(
                "Content-Disposition",
                f'attachment; filename="{original_name}"',
            )
            self.end_headers()
            self.wfile.write(body)

        def _sdk_call(self, fn: Callable[[], Mapping[str, Any]]) -> None:
            try:
                self._json(HTTPStatus.OK, fn())
            except Exception:  # noqa: BLE001 - hide SDK details from the browser
                self._json(
                    HTTPStatus.BAD_GATEWAY,
                    {"message": "mobilerun API request failed"},
                )

        def _read_body(self, maximum: int) -> bytes | None:
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                length = 0
            if length <= 0 or length > maximum:
                self._json(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    {"message": "invalid body size"},
                )
                return None
            return self.rfile.read(length)

        def _json(
            self,
            status: int,
            payload: Mapping[str, Any],
            *,
            extra_headers: Mapping[str, str] | None = None,
        ) -> None:
            body = (
                b"" if status == HTTPStatus.NO_CONTENT else json.dumps(payload).encode()
            )
            self._bytes(
                status,
                body,
                "application/json",
                extra_headers=extra_headers,
            )

        def _bytes(
            self,
            status: int,
            body: bytes,
            content_type: str,
            *,
            extra_headers: Mapping[str, str] | None = None,
        ) -> None:
            self.send_response(status)
            self._security_headers()
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for key, value in (extra_headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def _security_headers(self) -> None:
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; "
                "style-src 'self' https://fonts.googleapis.com; "
                "font-src https://fonts.gstatic.com; "
                "img-src 'self' data:; "
                "script-src 'self'; "
                "connect-src 'self'; "
                "base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
            )

        def log_message(self, fmt: str, *args: object) -> None:
            return

    return Handler


def build_showcase(
    settings: ShowcaseSettings,
) -> tuple[Showcase, bool]:
    client = Mobilerun(
        api_key=settings.api_key,
        base_url=settings.api_base_url,
    )
    owns_webhook = settings.webhook_id is None
    webhook_id: str | None = None
    try:
        if owns_webhook:
            webhook_path = f"/mobilerun/showcase-{secrets.token_hex(16)}"
            webhook_url = f"{settings.public_url}{webhook_path}"
            created = client.webhooks.create(
                url=webhook_url,
                description="Mobilerun live showcase (temporary)",
            )
            webhook = as_json(created)["data"]
            webhook_id = webhook["id"]
            webhook_secret = webhook["secret"]
        else:
            webhook_id = settings.webhook_id
            webhook_path = settings.webhook_path
            webhook_secret = settings.webhook_secret

        if not webhook_id or not webhook_path or not webhook_secret:
            raise ValueError("showcase webhook configuration is incomplete")

        config = Config(
            host=settings.host,
            port=settings.port,
            webhook_path=webhook_path,
            webhook_secret=webhook_secret.encode(),
            api_base_url=settings.api_base_url,
            api_key=settings.api_key,
            download_dir=settings.download_dir,
            max_body_bytes=65_536,
            max_file_bytes=50 * 1024**2,
            max_timestamp_age_ms=300_000,
        )
        config.download_dir.mkdir(parents=True, exist_ok=True)
        return Showcase(settings, config, client, webhook_id), owns_webhook
    except Exception:
        if owns_webhook and webhook_id and settings.delete_webhook_on_exit:
            _delete_webhook(client, webhook_id)
        raise


def _delete_webhook(client: Mobilerun, webhook_id: str) -> None:
    try:
        client.webhooks.delete(webhook_id)
    except Exception as exc:  # noqa: BLE001 - cleanup must not mask shutdown
        print(
            json.dumps(
                {
                    "warning": "temporary webhook cleanup failed",
                    "webhookId": webhook_id,
                    "error": type(exc).__name__,
                }
            ),
            flush=True,
        )


def main() -> None:
    try:
        settings = ShowcaseSettings.from_env()
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    showcase, owns_webhook = build_showcase(settings)
    server: ThreadingHTTPServer | None = None
    try:
        server = ThreadingHTTPServer(
            (settings.host, settings.port),
            make_handler(showcase),
        )
        server.daemon_threads = True

        def stop(*_: object) -> None:
            threading.Thread(target=server.shutdown, daemon=True).start()

        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)
        access_url = (
            f"{settings.public_url}/#access_token="
            f"{quote(settings.access_token, safe='')}"
        )
        print(
            json.dumps(
                {
                    "showcaseUrl": access_url,
                    "webhookUrl": showcase.webhook_url,
                    "webhookId": showcase.webhook_id,
                    "temporaryWebhook": owns_webhook,
                }
            ),
            flush=True,
        )
        server.serve_forever()
    finally:
        if server is not None:
            server.server_close()
        if owns_webhook and settings.delete_webhook_on_exit:
            _delete_webhook(showcase.client, showcase.webhook_id)


if __name__ == "__main__":
    main()
