# opencode-py-client

Thin, stateless Python client for an [OpenCode](https://opencode.ai) server.
The server owns sessions, history, agents, and streaming — this package only
does HTTP, session create, ask, stream, timeouts, and error mapping.

Verified against the server's live `/doc` spec (opencode 1.0.0):
`POST /session`, blocking `POST /session/{id}/message`,
`POST /session/{id}/prompt_async` + `GET /event` SSE.

## Install

```bash
pip install -e .
```

Requires Python ≥ 3.9, `httpx` only.

## Use

```python
from opencode_py_client import OpenCodeClient

with OpenCodeClient() as oc:  # default http://127.0.0.1:4096
    sid = oc.create_session("my chat")
    resp = oc.ask(sid, "What is 2+2?")
    print(resp.text)

    for delta in oc.ask_stream(sid, "Count to 5 slowly."):
        print(delta, end="", flush=True)
```

`OpenCodeClient(base_url=None, timeout_connect=5.0, timeout_execute=300.0)`.
`base_url` also reads `OPENCODE_BASE_URL` / `OPENCODE_SERVER_URL`.
`options={"agent": "build", "model": "opencode/model-id"}` selects agent/model.

Errors: `OpenCodeConnectionError`, `OpenCodeTimeoutError`,
`OpenCodeInvalidRequestError` (`OpenCodeNotFoundError` on 404),
`OpenCodeUpstreamError` — all carry `status_code` and `detail`.

See `examples/` for runnable scripts (need a running `opencode serve`).
`examples/web-chat/` is a dependency-free TS browser chat sample talking
directly to the server (see its README).
