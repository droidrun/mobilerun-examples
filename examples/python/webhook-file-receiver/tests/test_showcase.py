from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from showcase import Showcase, ShowcaseSettings
from support import FILE_ID, config

TRIGGER_ID = "3241bf38-38c5-4e41-99e6-d17e7d076ae0"


def settings(download_dir: Path, **overrides) -> ShowcaseSettings:
    values = {
        "public_url": "https://showcase.example",
        "api_base_url": "https://api.mobilerun.ai/v1",
        "api_key": "dr_sk_test",
        "host": "127.0.0.1",
        "port": 3000,
        "download_dir": download_dir,
        "access_token": "showcase-token",
        "trigger_id": TRIGGER_ID,
        "preview_max_bytes": 100_000,
        "webhook_id": None,
        "webhook_path": None,
        "webhook_secret": None,
        "delete_webhook_on_exit": True,
    }
    values.update(overrides)
    return ShowcaseSettings(**values)


class FakeTriggers:
    def __init__(self):
        self.fired = []

    def fire(self, trigger_id, *, payload):
        self.fired.append((trigger_id, payload))
        return {"enqueuedCount": 1}


class FakeWorkflows:
    def __init__(self):
        self.triggers = FakeTriggers()


class FakeClient:
    def __init__(self):
        self.workflows = FakeWorkflows()


class ShowcaseSettingsTests(unittest.TestCase):
    def test_requires_complete_reusable_webhook_configuration(self):
        with self.assertRaisesRegex(ValueError, "must be set together"):
            ShowcaseSettings.from_env(
                {
                    "PUBLIC_URL": "https://showcase.example",
                    "MOBILERUN_CLOUD_API_KEY": "dr_sk_test",
                    "SHOWCASE_WEBHOOK_ID": FILE_ID,
                }
            )

    def test_generates_private_access_token(self):
        result = ShowcaseSettings.from_env(
            {
                "PUBLIC_URL": "https://showcase.example",
                "MOBILERUN_CLOUD_API_KEY": "dr_sk_test",
            }
        )

        self.assertGreaterEqual(len(result.access_token), 32)
        self.assertTrue(result.delete_webhook_on_exit)


class ShowcaseTests(unittest.TestCase):
    def test_allows_only_configured_trigger(self):
        with tempfile.TemporaryDirectory() as directory:
            client = FakeClient()
            showcase = Showcase(
                settings(Path(directory)),
                config(Path(directory)),
                client,
                FILE_ID,
            )

            result = showcase.start_workflow(TRIGGER_ID, {"source": "test"})

            self.assertEqual(result["enqueuedCount"], 1)
            self.assertEqual(client.workflows.triggers.fired[0][0], TRIGGER_ID)
            with self.assertRaisesRegex(ValueError, "not enabled"):
                showcase.start_workflow(FILE_ID, {})

    def test_previews_small_text_files_only(self):
        with tempfile.TemporaryDirectory() as directory:
            download_dir = Path(directory)
            path = download_dir / f"{FILE_ID}--result.csv"
            path.write_text("name,value\nBattery,100%\n")
            showcase = Showcase(
                settings(download_dir),
                config(download_dir),
                FakeClient(),
                FILE_ID,
            )

            text = showcase.preview({"fileId": FILE_ID, "mimeType": "text/csv"})
            binary = showcase.preview(
                {"fileId": FILE_ID, "mimeType": "application/zip"}
            )

            self.assertIn("Battery,100%", text)
            self.assertIsNone(binary)


if __name__ == "__main__":
    unittest.main()
