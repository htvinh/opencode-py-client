# OpenCode Client Package — Specification

**Version:** 1.0  
**Status:** Proposed  
**Purpose:** Provide a minimal, reusable Python package that connects application UIs to an OpenCode server.

## 1. Objective

Develop a lightweight Python package that acts as a client for an existing OpenCode server.

The package receives questions from an application, forwards them to OpenCode, retrieves the generated responses, and returns those responses to the application UI.

The package is a communication client, not an AI agent, orchestration framework, or independent runtime.

## 2. Architecture

Application UI → OpenCode Client Package → OpenCode Server

- **Application UI:** Collects user questions and displays responses.
- **OpenCode Client Package:** Manages HTTP communication, session creation, message submission, response retrieval, and optional streaming.
- **OpenCode Server:** Owns conversation sessions, messages, agents, tools, model execution, and native event streaming.

Default OpenCode server URL: `http://127.0.0.1:4096`, configurable through the package constructor or environment variables.

## 3. Functional Requirements

### FR-01: Create Session
Create a conversation session through the OpenCode server and return its native session ID.

### FR-02: Submit Question
Accept a question and an existing session ID, then submit the question to OpenCode.

### FR-03: Retrieve Response
Wait for execution to complete and return the assistant's response in a simple, application-friendly structure.

### FR-04: Stream Response
Optionally expose response chunks or normalized text deltas as they arrive, allowing the UI to display progressive output.

### FR-05: Manage Session
Allow callers to reuse session IDs across multiple questions. Session history remains under OpenCode's control.

### FR-06: Handle Errors
Provide consistent client-side exceptions for connection failures, timeouts, invalid requests, and upstream errors. Preserve useful upstream error details for diagnostics.

### FR-07: Manage Resources
Support explicit client cleanup and configurable connection and execution timeouts.

## 4. Public Python API

The package exposes a small, stable interface:

- `OpenCodeClient(base_url, ...)`
- `create_session(title=None)`
- `ask(session_id, question, options=None)`
- `ask_stream(session_id, question, options=None)`
- `close()`

`ask()` returns a completed response. `ask_stream()` yields incremental response data. `options` contains optional agent and model selections supported by the server.

The package must verify actual OpenCode endpoint paths, request schemas, response formats, and streaming events against the installed server's `/doc` specification before implementation.

## 5. Non-Functional Requirements

- **Minimalism:** Use Python and `httpx`; avoid unnecessary dependencies.
- **Reusability:** Independent of any particular UI framework or application.
- **Stateless client design:** Do not maintain a competing conversation database. Callers retain session IDs; OpenCode remains authoritative.
- **Configuration:** Support a configurable server URL, authentication settings when required, and timeouts.
- **Testability:** Support unit tests with mocked HTTP responses and integration tests against a running OpenCode server.
- **Compatibility:** Keep the public API independent of OpenCode-specific payload structures wherever practical.

## 6. Explicitly Out of Scope

- A standalone FastAPI server.
- A built-in web UI.
- A database or persistent session store.
- Agent orchestration or model routing.
- Independent conversation-history management.
- Application-specific business logic.
- A generic multi-backend adapter framework.

A FastAPI wrapper may be added later if a browser-based UI needs an HTTP endpoint to access the Python package.

## 7. Acceptance Criteria

1. An application can instantiate the client and connect to a running OpenCode server.
2. The client can create a session and submit a question.
3. The client returns the completed assistant response.
4. The client supports optional incremental response streaming.
5. Multiple questions can reuse the same session.
6. Errors and timeouts are handled predictably.
7. No separate liaison process or database is required.
8. The package works independently of the consuming application's UI framework.

## 8. Deliverable

An installable Python package named `opencode-client`, with a concise README, minimal examples, automated tests, and verified compatibility with the target OpenCode server version.