from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import pytest
from mobilerun_webhook_receiver.application import WebhookApplication
from support import NOW_MS, FakeDownloader, config, signed_headers

BODY = b'{"id":"event-1","type":"webhook.test"}'


@pytest.fixture
def app():
    with patch("time.time", return_value=NOW_MS / 1000):
        yield WebhookApplication(
            config(Path("unused")), downloader=FakeDownloader(Path("unused"))
        )


def test_accepts_valid_signature(app):
    status, result = app.handle(signed_headers(BODY, timestamp=NOW_MS), BODY)
    assert status == 200
    assert result["eventId"] == "event-1"


@pytest.mark.parametrize(
    "body,timestamp,signature_value,reason",
    [
        (b"not JSON", NOW_MS, None, "invalid_signature"),
        (BODY, NOW_MS, "sha256=bad", "malformed"),
        (BODY, NOW_MS - 300_001, None, "timestamp_out_of_tolerance"),
        (BODY, NOW_MS + 300_001, None, "timestamp_out_of_tolerance"),
    ],
)
def test_maps_verification_failures_to_unauthorized(
    app, body, timestamp, signature_value, reason
):
    headers = signed_headers(BODY, timestamp=timestamp, signature_value=signature_value)
    assert app.handle(headers, body) == (401, {"message": reason})


@pytest.mark.parametrize("age_ms,status", [(1001, 401), (999, 200)])
def test_respects_configured_tolerance(app, age_ms, status):
    app.config = replace(app.config, max_timestamp_age_ms=1000)
    headers = signed_headers(BODY, timestamp=NOW_MS - age_ms)
    assert app.handle(headers, BODY)[0] == status


@pytest.mark.xfail(strict=True, reason="needs mobilerun-sdk 6.2.1 invalid_json")
def test_signed_non_json_returns_bad_request(app):
    body = b"not JSON"
    headers = signed_headers(body, timestamp=NOW_MS)
    assert app.handle(headers, body) == (400, {"message": "invalid JSON"})
