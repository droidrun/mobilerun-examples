from __future__ import annotations

import json
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from mobilerun_webhook_receiver.application import WebhookApplication
from support import FILE_ID, FakeDownloader, config, signed_headers


class ApplicationTests(unittest.TestCase):
    def test_downloads_once_and_deduplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "saved.csv"
            downloader = FakeDownloader(destination)
            app = WebhookApplication(
                config(Path(directory)),
                downloader=downloader,
            )
            event = {
                "id": "event-1",
                "type": "workflow.step.emit",
                "data": {
                    "file": {
                        "fileId": FILE_ID,
                        "filename": "android-settings.csv",
                        "mimeType": "text/csv",
                        "sizeBytes": 10,
                        "downloadPath": f"/v1/agents/files/{FILE_ID}/download",
                    }
                },
            }
            body = json.dumps(event, separators=(",", ":")).encode()
            timestamp = str(int(time.time() * 1000))
            headers = signed_headers(
                body, timestamp=timestamp, event_type="workflow.step.emit"
            )

            output = StringIO()
            with redirect_stdout(output):
                status, result = app.handle(headers, body)
            self.assertEqual(status, 200)
            self.assertEqual(result["file"]["filename"], "android-settings.csv")
            self.assertNotIn("savedTo", result["file"])
            self.assertNotIn("android-settings.csv", output.getvalue())
            self.assertNotIn(str(destination), output.getvalue())
            self.assertEqual(downloader.calls, 1)

            status, result = app.handle(headers, body)
            self.assertEqual(status, 200)
            self.assertEqual(result["message"], "duplicate ignored")
            self.assertEqual(downloader.calls, 1)

    def test_rejects_header_body_event_id_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            app = WebhookApplication(
                config(Path(directory)),
                downloader=FakeDownloader(Path(directory) / "unused"),
            )
            body = b'{"id":"body-id","type":"webhook.test","data":{}}'
            timestamp = str(int(time.time() * 1000))
            headers = signed_headers(body, timestamp=timestamp, event_id="header-id")

            status, result = app.handle(headers, body)

            self.assertEqual(status, 400)
            self.assertEqual(result["message"], "event id mismatch")

    def test_rejects_header_body_event_type_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            downloader = FakeDownloader(Path(directory) / "unused")
            app = WebhookApplication(config(Path(directory)), downloader=downloader)
            body = b'{"id":"event-1","type":"webhook.test","data":{}}'
            timestamp = str(int(time.time() * 1000))
            headers = signed_headers(
                body, timestamp=timestamp, event_type="workflow.step.emit"
            )

            status, result = app.handle(headers, body)

            self.assertEqual(status, 400)
            self.assertEqual(result["message"], "event type mismatch")
            self.assertEqual(downloader.calls, 0)

    def test_accepts_case_insensitive_webhook_headers(self):
        with tempfile.TemporaryDirectory() as directory:
            app = WebhookApplication(
                config(Path(directory)),
                downloader=FakeDownloader(Path(directory) / "unused"),
            )
            body = b'{"id":"event-case","type":"webhook.test","data":{}}'
            timestamp = str(int(time.time() * 1000))
            headers = {
                key.lower(): value
                for key, value in signed_headers(
                    body,
                    timestamp=timestamp,
                    event_id="event-case",
                    event_type="webhook.test",
                ).items()
            }

            status, result = app.handle(headers, body)

            self.assertEqual(status, 200)
            self.assertEqual(result["eventId"], "event-case")


if __name__ == "__main__":
    unittest.main()
