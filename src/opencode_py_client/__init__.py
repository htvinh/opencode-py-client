"""opencode-py-client — thin, stateless Python client for an OpenCode server."""

from .client import OpenCodeClient
from .errors import (
    OpenCodeConnectionError,
    OpenCodeError,
    OpenCodeInvalidRequestError,
    OpenCodeNotFoundError,
    OpenCodeTimeoutError,
    OpenCodeUpstreamError,
)
from .models import AskResponse

__all__ = [
    "OpenCodeClient",
    "AskResponse",
    "OpenCodeError",
    "OpenCodeConnectionError",
    "OpenCodeTimeoutError",
    "OpenCodeInvalidRequestError",
    "OpenCodeNotFoundError",
    "OpenCodeUpstreamError",
]
