"""App-friendly response types, decoupled from OpenCode payload shapes."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AskResponse:
    """Completed assistant response for `ask()`."""

    text: str
    session_id: str
    message_id: str | None = None
    agent: str | None = None
    model_id: str | None = None
    provider_id: str | None = None
    finish: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)
