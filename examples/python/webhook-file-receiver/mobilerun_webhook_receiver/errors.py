"""Domain errors returned by the webhook receiver."""


class ConfigurationError(ValueError):
    """Raised when required receiver configuration is missing or unsafe."""


class PayloadError(ValueError):
    """Raised when a signed webhook payload violates the expected contract."""


class DownloadError(RuntimeError):
    """Raised when a referenced workflow file cannot be downloaded safely."""
