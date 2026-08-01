"""Environment-backed server configuration."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from .errors import ConfigurationError


def positive_int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be an integer") from exc
    if value <= 0:
        raise ConfigurationError(f"{name} must be positive")
    return value


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    webhook_path: str
    webhook_secret: bytes
    api_base_url: str
    api_key: str
    download_dir: Path
    max_body_bytes: int
    max_file_bytes: int
    max_timestamp_age_ms: int

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Config:
        values = os.environ if env is None else env
        webhook_path = values.get("WEBHOOK_PATH", "")
        secret = values.get("WEBHOOK_SECRET", "")
        api_key = values.get("MOBILERUN_CLOUD_API_KEY", "")
        api_base_url = values.get(
            "MOBILERUN_BASE_URL", "https://api.mobilerun.ai/v1"
        ).rstrip("/")

        if not webhook_path.startswith("/") or len(webhook_path) < 24:
            raise ConfigurationError(
                "WEBHOOK_PATH must start with '/' and contain at least 24 characters"
            )
        if not secret:
            raise ConfigurationError("WEBHOOK_SECRET is required")
        if not api_key:
            raise ConfigurationError("MOBILERUN_CLOUD_API_KEY is required")
        validate_api_base_url(api_base_url)

        age_seconds = positive_int(values, "MAX_TIMESTAMP_AGE_SECONDS", 300)
        return cls(
            host=values.get("HOST", "127.0.0.1"),
            port=positive_int(values, "PORT", 3000),
            webhook_path=webhook_path,
            webhook_secret=secret.encode(),
            api_base_url=api_base_url,
            api_key=api_key,
            download_dir=Path(values.get("DOWNLOAD_DIR", "./downloads")),
            max_body_bytes=positive_int(values, "MAX_WEBHOOK_BODY_BYTES", 65_536),
            max_file_bytes=positive_int(values, "MAX_FILE_BYTES", 50 * 1024**2),
            max_timestamp_age_ms=age_seconds * 1000,
        )


def validate_api_base_url(api_base_url: str) -> None:
    parsed = urlsplit(api_base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ConfigurationError("MOBILERUN_BASE_URL must be an absolute HTTP(S) URL")
    if parsed.scheme != "https" and parsed.hostname not in {
        "127.0.0.1",
        "localhost",
        "::1",
    }:
        raise ConfigurationError("MOBILERUN_BASE_URL must use HTTPS outside localhost")
