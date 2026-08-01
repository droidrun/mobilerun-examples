"""Standard-library HTTP adapter for the webhook application."""

from __future__ import annotations

import json
from collections.abc import Mapping
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .application import WebhookApplication
from .config import Config


def make_handler(application: WebhookApplication):
    class Handler(BaseHTTPRequestHandler):
        server_version = "mobilerun-webhook-receiver/1"

        def do_POST(self) -> None:
            if self.path != application.config.webhook_path:
                self._reply(HTTPStatus.NOT_FOUND, {"message": "not found"})
                return
            try:
                content_length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                self._reply(
                    HTTPStatus.BAD_REQUEST,
                    {"message": "invalid content length"},
                )
                return
            if (
                content_length <= 0
                or content_length > application.config.max_body_bytes
            ):
                self._reply(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    {"message": "invalid body size"},
                )
                return

            status, response = application.handle(
                self.headers,
                self.rfile.read(content_length),
            )
            self._reply(status, response)

        def _reply(self, status: int, payload: Mapping[str, Any]) -> None:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def log_request(
            self,
            code: int | str = "-",
            size: int | str = "-",
        ) -> None:
            print(
                json.dumps(
                    {
                        "remote": self.client_address[0],
                        "method": self.command,
                        "status": str(code),
                        "size": str(size),
                    }
                ),
                flush=True,
            )

        def log_message(self, fmt: str, *args: object) -> None:
            """Suppress BaseHTTPRequestHandler messages containing request paths."""

    return Handler


def run_server(config: Config | None = None) -> None:
    config = config or Config.from_env()
    config.download_dir.mkdir(parents=True, exist_ok=True)
    application = WebhookApplication(config)
    server = ThreadingHTTPServer(
        (config.host, config.port),
        make_handler(application),
    )
    server.daemon_threads = True
    print(
        json.dumps(
            {
                "listening": f"http://{config.host}:{config.port}",
                "webhookPathConfigured": True,
            }
        ),
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
