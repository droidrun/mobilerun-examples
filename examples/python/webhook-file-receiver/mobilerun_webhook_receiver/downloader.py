"""Validated and authenticated workflow-file downloads."""

from __future__ import annotations

import os
import re
import tempfile
from collections.abc import Mapping
from contextlib import closing
from http import HTTPStatus
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from mobilerun_sdk import APIError, Mobilerun

from .config import Config
from .errors import DownloadError, PayloadError

DOWNLOAD_PATH_RE = re.compile(
    r"^/v1/agents/files/"
    r"(?P<file_id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-"
    r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})/download$"
)
REDIRECT_STATUSES = {
    HTTPStatus.MOVED_PERMANENTLY,
    HTTPStatus.FOUND,
    HTTPStatus.SEE_OTHER,
    HTTPStatus.TEMPORARY_REDIRECT,
    HTTPStatus.PERMANENT_REDIRECT,
}


class MobilerunFileDownloader:
    """Download files without forwarding API auth to object storage."""

    def __init__(
        self,
        config: Config,
        *,
        sdk_client: Mobilerun | None = None,
        storage_client: httpx.Client | None = None,
    ):
        self.config = config
        self.sdk_client = sdk_client or Mobilerun(
            api_key=config.api_key,
            base_url=config.api_base_url,
        )
        self.storage_client = storage_client or httpx.Client(
            follow_redirects=False,
            timeout=60,
        )

    def download(self, file_data: Mapping[str, Any]) -> Path:
        file_id, filename, download_path, expected_size = self._validate(file_data)
        self.config.download_dir.mkdir(parents=True, exist_ok=True)
        destination = self.config.download_dir / f"{file_id}--{filename}"
        response = self._open_api_or_storage(download_path)
        self._validate_content_length(response)
        return self._save(response, destination, expected_size)

    def _validate(
        self, file_data: Mapping[str, Any]
    ) -> tuple[str, str, str, int | None]:
        file_id = self._required_string(file_data, "fileId")
        filename = self._safe_filename(self._required_string(file_data, "filename"))
        download_path = self._required_string(file_data, "downloadPath")
        expected_size = file_data.get("sizeBytes")

        try:
            canonical_file_id = str(UUID(file_id))
        except ValueError as exc:
            raise PayloadError("file.fileId must be a UUID") from exc

        match = DOWNLOAD_PATH_RE.fullmatch(download_path)
        if not match or str(UUID(match.group("file_id"))) != canonical_file_id:
            raise PayloadError(
                "file.downloadPath must be the mobilerun download path for fileId"
            )
        if expected_size is not None and (
            not isinstance(expected_size, int) or expected_size < 0
        ):
            raise PayloadError("file.sizeBytes must be a non-negative integer")
        if (
            isinstance(expected_size, int)
            and expected_size > self.config.max_file_bytes
        ):
            raise PayloadError("file exceeds MAX_FILE_BYTES")
        return canonical_file_id, filename, download_path, expected_size

    def _open_api_or_storage(self, download_path: str) -> httpx.Response:
        # The SDK base URL already ends in /v1. Webhook downloadPath values are
        # API-root paths that also start with /v1, so passing them through
        # verbatim would request /v1/v1/agents/files/... and return 404.
        sdk_path = download_path.removeprefix("/v1")
        try:
            response = self.sdk_client.get(
                sdk_path,
                cast_to=httpx.Response,
                options={
                    "headers": {"Accept": "application/octet-stream"},
                    "follow_redirects": False,
                },
                stream=True,
            )
        except APIError as exc:
            # Stainless raises for the intentional 302 to signed object
            # storage before returning the raw httpx response. Preserve the
            # redirect handling below without ever forwarding API auth.
            error_response = getattr(exc, "response", None)
            if (
                isinstance(error_response, httpx.Response)
                and error_response.status_code in REDIRECT_STATUSES
            ):
                return self._follow_storage_redirect(error_response)
            raise DownloadError("mobilerun file API request failed") from exc

        if response.status_code == HTTPStatus.OK:
            return response
        if response.status_code not in REDIRECT_STATUSES:
            response.close()
            raise DownloadError(
                f"mobilerun file API returned HTTP {response.status_code}"
            )
        return self._follow_storage_redirect(response)

    def _follow_storage_redirect(self, response: httpx.Response) -> httpx.Response:
        location = response.headers.get("Location")
        api_url = str(response.request.url)
        response.close()
        if not location:
            raise DownloadError("mobilerun file API redirect has no Location")

        storage_url = httpx.URL(api_url).join(location)
        parsed = urlsplit(str(storage_url))
        if parsed.scheme != "https" or not parsed.netloc:
            raise DownloadError("storage redirect must use an absolute HTTPS URL")

        request = self.storage_client.build_request(
            "GET",
            storage_url,
            headers={"User-Agent": "mobilerun-webhook-file-receiver/1"},
        )
        try:
            storage_response = self.storage_client.send(request, stream=True)
            storage_response.raise_for_status()
            return storage_response
        except httpx.HTTPError as exc:
            raise DownloadError("storage download failed") from exc

    def _validate_content_length(self, response: httpx.Response) -> None:
        content_length = response.headers.get("Content-Length")
        if not content_length:
            return
        try:
            declared_size = int(content_length)
        except ValueError as exc:
            response.close()
            raise DownloadError("download returned invalid Content-Length") from exc
        if declared_size > self.config.max_file_bytes:
            response.close()
            raise DownloadError("download exceeds MAX_FILE_BYTES")

    def _save(
        self,
        response: httpx.Response,
        destination: Path,
        expected_size: int | None,
    ) -> Path:
        temp_path: Path | None = None
        total = 0
        try:
            with (
                closing(response),
                tempfile.NamedTemporaryFile(
                    mode="wb",
                    prefix=".mobilerun-download-",
                    dir=self.config.download_dir,
                    delete=False,
                ) as temp,
            ):
                temp_path = Path(temp.name)
                for chunk in response.iter_bytes(64 * 1024):
                    total += len(chunk)
                    if total > self.config.max_file_bytes:
                        raise DownloadError("download exceeds MAX_FILE_BYTES")
                    temp.write(chunk)
                temp.flush()
                os.fsync(temp.fileno())

            if expected_size is not None and total != expected_size:
                raise DownloadError(
                    f"download size mismatch: expected {expected_size}, got {total}"
                )
            os.replace(temp_path, destination)
            return destination
        except Exception:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)
            raise

    @staticmethod
    def _required_string(data: Mapping[str, Any], key: str) -> str:
        value = data.get(key)
        if not isinstance(value, str) or not value:
            raise PayloadError(f"file.{key} must be a non-empty string")
        return value

    @staticmethod
    def _safe_filename(filename: str) -> str:
        if filename in {".", ".."} or Path(filename).name != filename:
            raise PayloadError("file.filename must not contain a path")
        if (
            "/" in filename
            or "\\" in filename
            or any(
                ord(character) < 32 or ord(character) == 127 for character in filename
            )
        ):
            raise PayloadError("file.filename contains an unsafe character")
        return filename
