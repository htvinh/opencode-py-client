"""Thin, stateless HTTP client for an OpenCode server.

Verified against the live server's ``/doc`` (OpenAPI 3.1, opencode 1.0.0):

- ``POST /session`` → ``Session`` JSON (``create_session``).
- ``POST /session/{sessionID}/message`` with
  ``{"parts": [{"type": "text", "text": ...}]}`` blocks and returns completed
  ``{"info": AssistantMessage, "parts": [...]}`` JSON (``ask``).
- ``POST /session/{sessionID}/prompt_async`` (204) + ``GET /event`` SSE stream
  of ``message.part.delta`` events filtered by ``properties.sessionID``,
  terminated by ``session.idle`` for that session (``ask_stream``).
"""

from __future__ import annotations

import json
import os
import time
from typing import Any, Iterator

import httpx

from .errors import (
    OpenCodeConnectionError,
    OpenCodeError,
    OpenCodeInvalidRequestError,
    OpenCodeNotFoundError,
    OpenCodeTimeoutError,
    OpenCodeUpstreamError,
)
from .models import AskResponse

DEFAULT_BASE_URL = "http://127.0.0.1:4096"
_ENV_VARS = ("OPENCODE_BASE_URL", "OPENCODE_SERVER_URL")


def _resolve_base_url(explicit: str | None) -> str:
    if explicit:
        return explicit.rstrip("/")
    for var in _ENV_VARS:
        val = os.environ.get(var)
        if val:
            return val.rstrip("/")
    return DEFAULT_BASE_URL


def _split_model(model: str | dict[str, Any] | None) -> tuple[str | None, str | None]:
    """Normalize ``options['model']`` to ``(providerID, modelID)``."""
    if model is None:
        return None, None
    if isinstance(model, dict):
        provider = model.get("providerID")
        mid = model.get("modelID", model.get("id"))
        return provider, mid
    for sep in ("/", ":"):
        if sep in model:
            provider, _, mid = model.partition(sep)
            return provider or None, mid or None
    return None, model


def _message_model_payload(options: dict[str, Any] | None) -> dict[str, Any]:
    if not options:
        return {}
    out: dict[str, Any] = {}
    if options.get("agent"):
        out["agent"] = options["agent"]
    provider, mid = _split_model(options.get("model"))
    if provider and mid:
        out["model"] = {"providerID": provider, "modelID": mid}
    elif mid:
        # Server requires both keys; without a provider we cannot send a
        # partial model object, so let the server default apply.
        pass
    for key in ("variant", "system", "tools", "noReply"):
        if key in options:
            out[key] = options[key]
    return out


def _session_model_payload(options: dict[str, Any] | None) -> dict[str, Any]:
    if not options:
        return {}
    out: dict[str, Any] = {}
    if options.get("agent"):
        out["agent"] = options["agent"]
    provider, mid = _split_model(options.get("model"))
    if provider and mid:
        out["model"] = {"id": mid, "providerID": provider}
    return out


def _extract_text(parts: list[dict[str, Any]]) -> str:
    return "".join(p.get("text", "") for p in parts if p.get("type") == "text")


class OpenCodeClient:
    """Stateless client; the server owns sessions and history.

    The caller retains session IDs — this client keeps no conversation store.
    """

    def __init__(
        self,
        base_url: str | None = None,
        *,
        timeout_connect: float = 5.0,
        timeout_execute: float = 300.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = _resolve_base_url(base_url)
        self.timeout_connect = timeout_connect
        self.timeout_execute = timeout_execute
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=httpx.Timeout(connect=timeout_connect, read=timeout_execute, write=timeout_execute, pool=timeout_connect),
            transport=transport,
        )
        self._closed = False

    # -- lifecycle ------------------------------------------------------
    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._client.close()

    def __enter__(self) -> OpenCodeClient:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # -- internal -------------------------------------------------------
    def _post(self, path: str, payload: dict[str, Any], *, timeout: float | None) -> httpx.Response:
        try:
            resp = self._client.post(path, json=payload, timeout=timeout)
        except httpx.ConnectError as e:
            raise OpenCodeConnectionError(f"cannot reach OpenCode server at {self.base_url}: {e}") from e
        except httpx.TimeoutException as e:
            raise OpenCodeTimeoutError(f"request to {path} timed out: {e}") from e
        except httpx.TransportError as e:
            raise OpenCodeConnectionError(f"transport error talking to {self.base_url}: {e}") from e
        self._raise_for_status(resp)
        return resp

    @staticmethod
    def _raise_for_status(resp: httpx.Response) -> None:
        if resp.status_code < 400:
            return
        try:
            detail: object = resp.json()
        except Exception:
            detail = resp.text
        msg = f"OpenCode server returned {resp.status_code}: {detail!r:.500}"
        if resp.status_code == 404:
            raise OpenCodeNotFoundError(msg, status_code=404, detail=detail)
        if 400 <= resp.status_code < 500:
            raise OpenCodeInvalidRequestError(msg, status_code=resp.status_code, detail=detail)
        raise OpenCodeUpstreamError(msg, status_code=resp.status_code, detail=detail)

    # -- public API -----------------------------------------------------
    def create_session(self, title: str | None = None, options: dict[str, Any] | None = None) -> str:
        """Create a session; return its native session ID (``ses_...``)."""
        payload: dict[str, Any] = {}
        if title is not None:
            payload["title"] = title
        payload.update(_session_model_payload(options))
        resp = self._post("/session", payload, timeout=self.timeout_connect)
        try:
            return resp.json()["id"]
        except (KeyError, ValueError) as e:
            raise OpenCodeUpstreamError(f"unexpected session response: {resp.text!r:.500}", detail=resp.text) from e

    def ask(
        self,
        session_id: str,
        question: str,
        options: dict[str, Any] | None = None,
        *,
        timeout: float | None = None,
    ) -> AskResponse:
        """Submit ``question`` and block until the completed response arrives."""
        if not session_id:
            raise OpenCodeInvalidRequestError("session_id is required")
        payload = {"parts": [{"type": "text", "text": question}]}
        payload.update(_message_model_payload(options))
        resp = self._post(
            f"/session/{session_id}/message",
            payload,
            timeout=self.timeout_execute if timeout is None else timeout,
        )
        try:
            data = resp.json()
        except ValueError as e:
            raise OpenCodeUpstreamError(f"unexpected message response: {resp.text!r:.500}", detail=resp.text) from e
        info = data.get("info", {})
        parts = data.get("parts", [])
        if info.get("error"):
            raise OpenCodeUpstreamError(
                f"assistant message carries error: {info['error']!r:.500}",
                message_error=info["error"],
                detail=data,
            )
        return AskResponse(
            text=_extract_text(parts),
            session_id=info.get("sessionID", session_id),
            message_id=info.get("id"),
            agent=info.get("agent"),
            model_id=info.get("modelID"),
            provider_id=info.get("providerID"),
            finish=info.get("finish"),
            raw=data,
        )

    def ask_stream(
        self,
        session_id: str,
        question: str,
        options: dict[str, Any] | None = None,
        *,
        timeout: float | None = None,
    ) -> Iterator[str]:
        """Yield incremental text deltas as they arrive.

        Subscribe-then-send order is required: the SSE subscription on
        ``GET /event`` opens first, then ``prompt_async`` fires, so no early
        delta is missed. A separate short-lived HTTP client sends the prompt
        because the streaming connection occupies this client's socket.
        Terminates on ``session.idle`` for this session.
        """
        if not session_id:
            raise OpenCodeInvalidRequestError("session_id is required")
        limit = self.timeout_execute if timeout is None else timeout
        deadline = time.monotonic() + limit
        payload = {"parts": [{"type": "text", "text": question}]}
        payload.update(_message_model_payload(options))

        try:
            with self._client.stream("GET", "/event", timeout=limit) as stream:
                self._raise_for_status(stream)
                # Fire the prompt only once the subscription is live.
                try:
                    fire = httpx.post(
                        f"{self.base_url}/session/{session_id}/prompt_async",
                        json=payload,
                        timeout=self.timeout_connect,
                    )
                except httpx.ConnectError as e:
                    raise OpenCodeConnectionError(f"cannot reach OpenCode server at {self.base_url}: {e}") from e
                except httpx.TimeoutException as e:
                    raise OpenCodeTimeoutError(f"prompt_async timed out: {e}") from e
                self._raise_for_status(fire)

                for line in stream.iter_lines():
                    if time.monotonic() > deadline:
                        raise OpenCodeTimeoutError(f"stream for session {session_id} exceeded {limit}s")
                    if not line or line.startswith(":"):
                        continue
                    if not line.startswith("data:"):
                        continue
                    try:
                        event = json.loads(line[5:].strip())
                    except ValueError:
                        continue
                    props = event.get("properties", {})
                    if props.get("sessionID") != session_id:
                        continue
                    etype = event.get("type", "")
                    if etype == "session.error":
                        raise OpenCodeUpstreamError(
                            f"session error: {props.get('error')!r:.500}", detail=event
                        )
                    if etype == "message.part.delta" and props.get("field", "text") == "text":
                        delta = props.get("delta", "")
                        if delta:
                            yield delta
                    elif etype == "session.idle":
                        return
                    elif etype == "session.status" and props.get("status", {}).get("type") == "idle":
                        return
        except httpx.TimeoutException as e:
            raise OpenCodeTimeoutError(f"stream for session {session_id} timed out: {e}") from e
        except httpx.ConnectError as e:
            raise OpenCodeConnectionError(f"cannot reach OpenCode server at {self.base_url}: {e}") from e
        except OpenCodeError:
            raise
        except Exception as e:
            raise OpenCodeUpstreamError(f"stream failed: {e}") from e
