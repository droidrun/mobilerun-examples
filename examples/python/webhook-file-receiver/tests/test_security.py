from __future__ import annotations

import unittest

from support import NOW_MS, SECRET, signature

from mobilerun_webhook_receiver.errors import PayloadError
from mobilerun_webhook_receiver.security import verify_signature


class SignatureTests(unittest.TestCase):
    def test_accepts_valid_signature(self):
        body = b'{"ok":true}'
        verify_signature(
            body,
            str(NOW_MS),
            signature(body),
            SECRET,
            now_ms=NOW_MS,
        )

    def test_rejects_invalid_signature(self):
        with self.assertRaisesRegex(PayloadError, "invalid signature"):
            verify_signature(
                b"{}",
                str(NOW_MS),
                "sha256=bad",
                SECRET,
                now_ms=NOW_MS,
            )

    def test_rejects_stale_timestamp(self):
        body = b"{}"
        timestamp = str(NOW_MS - 300_001)
        with self.assertRaisesRegex(PayloadError, "stale timestamp"):
            verify_signature(
                body,
                timestamp,
                signature(body, timestamp),
                SECRET,
                now_ms=NOW_MS,
            )


if __name__ == "__main__":
    unittest.main()
