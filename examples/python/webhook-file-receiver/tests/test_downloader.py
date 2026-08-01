from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import httpx
from mobilerun_sdk import APIStatusError
from mobilerun_webhook_receiver.downloader import MobilerunFileDownloader
from mobilerun_webhook_receiver.errors import PayloadError
from support import FILE_ID, config


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


class RaisingRedirectSdkClient(RedirectingSdkClient):
    def get(self, path, **kwargs):
        response = super().get(path, **kwargs)
        raise APIStatusError("redirect", response=response, body=None)


class DownloaderTests(unittest.TestCase):
    def test_rejects_filename_traversal(self):
        with self.assertRaisesRegex(PayloadError, "must not contain"):
            MobilerunFileDownloader._safe_filename("../secret")

    def test_rejects_filename_control_characters(self):
        with self.assertRaisesRegex(PayloadError, "unsafe character"):
            MobilerunFileDownloader._safe_filename("report.csv\r\nX-Test: injected")

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
                f"/agents/files/{FILE_ID}/download",
            )
            self.assertNotIn("Authorization", storage_requests[0].headers)

    def test_sdk_redirect_exception_is_followed_without_bearer_token(self):
        with tempfile.TemporaryDirectory() as directory:
            sdk_client = RaisingRedirectSdkClient()
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
            self.assertNotIn("Authorization", storage_requests[0].headers)


if __name__ == "__main__":
    unittest.main()
