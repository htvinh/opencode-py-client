"""Typed client exceptions, preserving upstream detail."""

from __future__ import annotations


class OpenCodeError(Exception):
    """Base error for all opencode-client failures."""

    def __init__(self, message: str, *, status_code: int | None = None, detail: object = None):
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail


class OpenCodeConnectionError(OpenCodeError):
    """Server unreachable / connection refused / DNS / network failure."""


class OpenCodeTimeoutError(OpenCodeError):
    """Connect or execution timeout elapsed."""


class OpenCodeInvalidRequestError(OpenCodeError):
    """4xx caused by a bad caller request (bad session ID, bad payload)."""


class OpenCodeNotFoundError(OpenCodeInvalidRequestError):
    """404 — unknown session/message."""


class OpenCodeUpstreamError(OpenCodeError):
    """Server returned 5xx, or the assistant message itself carries `error`."""

    def __init__(self, message: str, *, message_error: object = None, **kwargs):
        super().__init__(message, **kwargs)
        self.message_error = message_error
