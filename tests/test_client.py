"""Unit tests with mocked HTTP (no running server required)."""

import httpx
import pytest

from opencode_client import (
    OpenCodeClient,
    OpenCodeConnectionError,
    OpenCodeInvalidRequestError,
    OpenCodeNotFoundError,
    OpenCodeUpstreamError,
)

SID = "ses_test123"


def _client(handler):
    return OpenCodeClient(transport=httpx.MockTransport(handler))


def test_create_session_returns_id():
    def h(request):
        assert request.url.path == "/session"
        return httpx.Response(200, json={"id": SID, "title": "t"})

    c = _client(h)
    assert c.create_session("t") == SID
    c.close()


def test_ask_returns_text_only():
    def h(request):
        assert request.url.path == f"/session/{SID}/message"
        return httpx.Response(
            200,
            json={
                "info": {"id": "msg_1", "sessionID": SID, "agent": "build",
                         "modelID": "m", "providerID": "p", "finish": "stop"},
                "parts": [
                    {"type": "text", "text": "hello "},
                    {"type": "reasoning", "text": "hidden"},
                    {"type": "text", "text": "world"},
                ],
            },
        )

    c = _client(h)
    resp = c.ask(SID, "hi")
    assert resp.text == "hello world"
    assert resp.message_id == "msg_1"
    c.close()


def test_ask_message_error_raises_upstream():
    def h(request):
        return httpx.Response(200, json={"info": {"id": "m", "error": {"name": "X"}}, "parts": []})

    c = _client(h)
    with pytest.raises(OpenCodeUpstreamError):
        c.ask(SID, "hi")
    c.close()


def test_ask_404_maps_to_not_found():
    def h(request):
        return httpx.Response(404, json={"name": "NotFoundError"})

    c = _client(h)
    with pytest.raises(OpenCodeNotFoundError):
        c.ask("ses_nope", "hi")
    c.close()


def test_ask_400_maps_to_invalid():
    def h(request):
        return httpx.Response(400, json={"name": "BadRequest"})

    c = _client(h)
    with pytest.raises(OpenCodeInvalidRequestError):
        c.create_session("t")
    c.close()


def test_connect_error_maps_to_connection():
    def h(request):
        raise httpx.ConnectError("refused")

    c = _client(h)
    with pytest.raises(OpenCodeConnectionError):
        c.create_session("t")
    c.close()


def test_options_model_mapping():
    seen = {}

    def h(request):
        import json as j
        seen.update(j.loads(request.content))
        return httpx.Response(200, json={"id": SID})

    c = _client(h)
    c.create_session("t", options={"agent": "build", "model": "opencode/m"})
    assert seen["agent"] == "build"
    assert seen["model"] == {"id": "m", "providerID": "opencode"}
    c.close()
