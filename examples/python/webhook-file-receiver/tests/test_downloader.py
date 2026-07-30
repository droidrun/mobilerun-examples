from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import httpx

from support import FILE_ID, config

from mobilerun_webhook_receiver.downloader import MobilerunFileDownloader
from mobilerun_webhook_receiver.errors import PayloadError


class RedirectingSdkClient:
    def __init__(self):
        self.calls = []

    def get(self, path, **kwargs):
        self.calls.append((path, kwargs))
        request = httpx.Request(
            "GET",
            f"https://api.mobilerun.ai{path}",
            headers={"Authorization": "Bearer dr_sk_test"},
        )
        return httpx.Response(
            302,
            headers={"Location": "https://storage.example/presigned-file"},
            request=request,
        )


class DownloaderTests(unittest.TestCase):
    def test_rejects_filename_traversal(self):
        with self.assertRaisesRegex(PayloadError, "must not contain"):
            MobilerunFileDownloader._safe_filename("../secret")

    def test_storage_redirect_does_not_receive_bearer_token(self):
        with tempfile.TemporaryDirectory() as directory:
            sdk_client = RedirectingSdkClient()
            storage_requests = []

            def storage_handler(request):
                storage_requests.append(request)
                return httpx.Response(200, content=b"csv", request=request)

            downloader = MobilerunFileDownloader(
                config(Path(directory)),
                sdk_client=sdk_client,
                storage_client=httpx.Client(
                    transport=httpx.MockTransport(storage_handler)
                ),
            )
            saved = downloader.download(
                {
                    "fileId": FILE_ID,
                    "filename": "result.csv",
                    "sizeBytes": 3,
                    "downloadPath": f"/v1/agents/files/{FILE_ID}/download",
                }
            )

            self.assertEqual(saved.read_bytes(), b"csv")
            self.assertEqual(
                sdk_client.calls[0][0],
                f"/v1/agents/files/{FILE_ID}/download",
            )
            self.assertNotIn("Authorization", storage_requests[0].headers)


if __name__ == "__main__":
    unittest.main()
