from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import pytest
from mobilerun_sdk import WebhookVerificationError
from mobilerun_webhook_receiver.application import WebhookApplication
from mobilerun_webhook_receiver.security import (
    EVENT_ID_HEADER,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
)
from support import NOW_MS, FakeDownloader, config, signature


@pytest.fixture
def app():
    return WebhookApplication(
        config(Path("unused")), downloader=FakeDownloader(Path("unused"))
    )


def handle(app, body, *, timestamp=NOW_MS, signed_body=None):
    headers = {
        TIMESTAMP_HEADER: str(timestamp),
        SIGNATURE_HEADER: signature(
            body if signed_body is None else signed_body, str(timestamp)
        ),
        EVENT_ID_HEADER: "event-1",
    }
    with patch(
        "mobilerun_webhook_receiver.application.time.time", return_value=NOW_MS / 1000
    ):
        return app.handle(headers, body)


BODY = b'{"id":"event-1","type":"webhook.test"}'


def test_accepts_valid_signature(app):
    status, result = handle(app, BODY)
    assert status == 200
    assert result["eventId"] == "event-1"


def test_rejects_tampered_body_before_parsing(app):
    assert handle(app, b"not JSON", signed_body=BODY) == (
        401,
        {"message": "invalid_signature"},
    )


def test_rejects_malformed_signature(app):
    headers = {
        TIMESTAMP_HEADER: str(NOW_MS),
        SIGNATURE_HEADER: "sha256=bad",
        EVENT_ID_HEADER: "event-1",
    }
    with patch(
        "mobilerun_webhook_receiver.application.time.time", return_value=NOW_MS / 1000
    ):
        assert app.handle(headers, BODY) == (401, {"message": "malformed"})


@pytest.mark.parametrize("offset_ms", [-300_001, 300_001])
def test_rejects_stale_or_future_timestamp(app, offset_ms):
    assert handle(app, BODY, timestamp=NOW_MS + offset_ms) == (
        401,
        {"message": "timestamp_out_of_tolerance"},
    )


def test_respects_configured_tolerance(app):
    app.config = replace(app.config, max_timestamp_age_ms=1000)
    assert handle(app, BODY, timestamp=NOW_MS - 1001)[0] == 401
    assert handle(app, BODY, timestamp=NOW_MS - 999)[0] == 200


def test_maps_authenticated_invalid_json_reason(app):
    with patch(
        "mobilerun_sdk.verify_webhook",
        side_effect=WebhookVerificationError("invalid_json"),
    ):
        assert handle(app, b"not JSON") == (400, {"message": "invalid JSON"})


@pytest.mark.xfail(strict=True, reason="needs mobilerun-sdk 6.2.1 invalid_json")
def test_signed_non_json_returns_bad_request(app):
    assert handle(app, b"not JSON") == (400, {"message": "invalid JSON"})
