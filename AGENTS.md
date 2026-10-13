# AGENTS.md — opencode-py-client

## State
Scaffolded installable package (`pyproject.toml`, `src/opencode_py_client/`, `tests/`, `examples/`). Verified live against opencode 1.0.0 at `http://127.0.0.1:4096`. Source of truth for routes is the server's `/doc`; `idea.md` is the scope spec.

## Commands
- `pip install -e ".[dev]"` then `python -m pytest -q` (7 mocked-HTTP unit tests, no server needed)
- Live check (needs `opencode serve`): `python3 examples/basic_ask.py` and `python3 examples/stream_ask.py`
- Web-chat sample (`examples/web-chat/`, zero-dep TS): `npx -y -p typescript@5 tsc -p tsconfig.json --noEmit` to typecheck; compile + serve over http to run (see its README). Do not add npm deps/frameworks.

## What to build
Thin, stateless Python client: `App UI → opencode-py-client → OpenCode Server`. Server owns sessions, history, agents, streaming. Client only does HTTP, session create, ask, stream, timeouts, error mapping.

Target public API (`idea.md` §4):
- `OpenCodeClient(base_url, ...)` — default `http://127.0.0.1:4096`, overridable via ctor/env
- `create_session(title=None)` → native session ID
- `ask(session_id, question, options=None)` → completed response
- `ask_stream(session_id, question, options=None)` → incremental deltas
- `close()` + configurable connection/execution timeouts

## Constraints (from spec — do not expand scope)
- Deps: Python + `httpx` only. No extra frameworks.
- No FastAPI server, web UI, DB/session store, history management, agent orchestration, model routing, business logic, or multi-backend adapter.
- Callers keep session IDs; never build a competing conversation store.
- `ask()` returns app-friendly structure, decoupled from OpenCode payload shapes where practical.
- Errors: typed client exceptions (connection/timeout/invalid/upstream) preserving upstream detail.

## Gotcha before coding
- Verified `/doc` mapping (opencode 1.0.0): `POST /session` → create; blocking `POST /session/{id}/message` (`{"parts":[{"type":"text","text"}]}` → `{"info","parts"}`) → `ask()`; `POST .../prompt_async` (204) + `GET /event` SSE → `ask_stream()`. Do not hardcode other routes.
- `ask()` extracts joined `type=="text"` parts; raises on `info.error`.
- `ask_stream()` must subscribe to `/event` BEFORE firing `prompt_async` (separate HTTP client for the fire, same-thread reentrancy), filter `properties.sessionID`, yield `message.part.delta` text, stop on `session.idle`. Deliberately ignores `message.part.updated` (would duplicate).
