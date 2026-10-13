# web-chat — TS front-end sample (no framework, no deps)

Talks **directly** to the OpenCode server from the browser (CORS is open on
the server). Mirrors the Python `opencode-client` endpoints:

- `POST /session` → `createSession()`
- blocking `POST /session/{id}/message` → `ask()`
- `POST .../prompt_async` + `GET /event` SSE → `askStream()` (subscribes
  **before** firing the prompt, filters `properties.sessionID`, yields
  `message.part.delta` text, stops on `session.idle`)
- `message.part.updated` → `onActivity` feed (stream mode only): step
  start/finish, tool running/finished, reasoning — shown in the UI's
  collapsible "Agent working" panel
- `question.asked` / `permission.asked` → interactive cards: the agent pauses
  (no `session.idle`) until you answer (`POST /question/{id}/reply`) or
  approve tools (`POST /permission/{id}/reply`)
- **Stop** button aborts the stream and `POST /session/{id}/abort`s the run

## Run

Needs a running server (`opencode serve`, default `http://127.0.0.1:4096`).

```bash
cd examples/web-chat
npx -y -p typescript@5 tsc -p tsconfig.json   # compiles src/ -> dist/
npx -y serve@14 .                          # or: python3 -m http.server 8000
# open http://localhost:3000 (or :8000) — NOT the index.html file directly
# (fetch + ES modules need http; file:// will fail)
```

Typecheck only: `npx -y -p typescript@5 tsc -p tsconfig.json --noEmit`.
