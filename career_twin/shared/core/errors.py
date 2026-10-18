"""Shared failure contracts, independent of providers and business workflows."""


class AppError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 502, *, retry_at: str | None = None):
        self.code, self.message, self.status_code = code, message, status_code
        self.retry_at = retry_at
        super().__init__(code)


class InvalidModelOutput(ValueError):
    """Only a developer-authored reason code; never include model/user text."""
    def __init__(self, reason="reference_or_fact_check"):
        self.reason = reason
        super().__init__(reason)
