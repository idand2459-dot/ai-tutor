# System Architecture

## Purpose
- Provide a concise architecture reference for service boundaries, ownership, and major flows.

## System Overview
- The runtime is one process: the `proxy` in `backend/` (Node.js 22.12+, TypeScript, ESM, Express 5).
- The `proxy` receives a `chat` from the browser, adds the `system prompt`, calls the Anthropic
  Messages API with streaming, and relays the `tutor` reply to the browser as Server-Sent Events (SSE).
- The `proxy` is the only component that holds `ANTHROPIC_API_KEY`.
- The `proxy` is stateless. There is no database; the browser sends the whole `chat` on every request.
- `frontend/` does not exist in the repository yet.

## Primary Components
All paths are under `backend/src/`.

| File | Responsibility |
|---|---|
| `index.ts` | Entry point. Loads config, builds the Anthropic client with the API key, and listens on `127.0.0.1:PORT`. Exits with code 1 on invalid config. |
| `app.ts` | `createApp({ client, config, log? })`. Wires the request id, CORS, the JSON body parser (2 MB limit), the routes, the 404 handler, and the final error handler. Receives the Anthropic client from the caller and never sees the API key. |
| `route/chat.ts` | `POST /api/chat`. Validates the body, streams the `tutor` reply as SSE, maps errors to the contract codes, aborts the upstream request when the client disconnects, and logs failures. |
| `lib/config.ts` | Reads and validates `ANTHROPIC_API_KEY`, `FRONTEND_URL`, `PORT`, and `ANTHROPIC_MODEL`. Error messages name variables, never values. |
| `lib/chat-request.ts` | Request body schema (zod) and `validateChatRequest`. |
| `lib/chat.service.ts` | Maps `tutor` to the Anthropic role `assistant`, calls `client.messages.stream`, yields reply text, throws `TutorRefusedError` on a `refusal` stop reason, and exposes `abort()`. |
| `lib/system-prompt.ts` | `SYSTEM_PROMPT`, the `system prompt` sent with every request. |
| `lib/http-error.ts` | The standard error shape and `sendError`. |

## Data Flow
`POST /api/chat`:
1. `app.ts` assigns a random UUID request id, sets `X-Request-Id`, applies CORS, and parses the JSON body.
   An unreadable or oversized body ends here with `400 validation_error`.
2. `route/chat.ts` validates the body. A violation ends here with `400 validation_error`; no
   request reaches Anthropic.
3. `chat.service.ts` sends `model`, `max_tokens: 4096`, `system`, and the mapped `messages` to
   `client.messages.stream`. It sends no `thinking` and no `output_config`.
4. The route waits for the first piece of reply text before it sends headers. A failure at this
   point returns a JSON error with a real HTTP status.
5. The route sends `200 text/event-stream`, one `delta` event per text piece, then `done`.
   A failure after this point sends one `error` event instead of `done`.
6. If the client disconnects before the reply ends, the route calls `abort()` and stops writing.

`GET /api/health` returns `{ "status": "ok" }` without calling Anthropic.

## Auth
- There is no user authentication; accounts are out of product scope.
- Access is limited by binding to `127.0.0.1` only. Any local process can still call the `proxy`.
- CORS allows only `FRONTEND_URL`. CORS is enforced by browsers; it does not block non-browser clients.
- The Anthropic API key is read from the environment in `index.ts` and passed to the SDK client.
  It is never sent to the browser and never logged.

## External Dependencies
- Anthropic Messages API, through `@anthropic-ai/sdk` (`client.messages.stream`).
- Model: `claude-haiku-4-5` unless `ANTHROPIC_MODEL` is set.
- The client is built with SDK defaults: up to 2 retries on connection errors, 408, 409, 429, and
  5xx, and a 10-minute timeout. The `proxy` adds no retries of its own.

## Operational Concerns
- Logging: one JSON line per failure on stderr. A successful request logs nothing.
  - `chat` failures: `level`, `requestId`, `operation`, `status` (the HTTP status the client got:
    `200` once the stream has started), `code`, `phase` (`before_stream` or `mid_stream`), and
    `upstreamError` (the error class name).
  - Unexpected errors in the final error handler: `level`, `requestId`, `operation: "http"`,
    `status: 500`, `code`, and `errorType`.
  - Startup: one JSON line on stdout with the address and the model.
  - Logs never contain `message` content, request headers, provider error messages, or the API key.
- Failure handling: see the error tables in the API Contract. Refusals and rate limits log at
  `warn`; everything else at `error`. Errors after the stream starts are not retried.
- Limits: 2 MB request body, 50 `message` items, 8,000 characters per `message`, and 4,096 output tokens.
- Monitoring: `GET /api/health` only.

## API Contract
The contract between `frontend/` and the `backend/` proxy. This section is the only copy;
there is no `.orchestrate/api-contract.yaml`. Source plan: `.plan/001-2026-10-08-chat-proxy.md`.

### Conventions
- Base URL in development: `http://127.0.0.1:4000`. The proxy binds to `127.0.0.1` only.
- CORS allows only the origin in `FRONTEND_URL`.
- Every response carries an `X-Request-Id` header. Error bodies repeat it as `requestId`.
- Every non-2xx JSON response uses the standard error shape:

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "human-readable summary",
    "details": {}
  },
  "requestId": "correlation-id"
}
```

`error.details` is optional and appears mainly on `validation_error`. Error bodies never
contain provider payloads, stack traces, or secrets.

### `GET /api/health`
Liveness check.

- `200 application/json` — `{ "status": "ok" }`

### `POST /api/chat`
Sends the full `chat` and streams the `tutor` reply. The proxy is stateless: the client sends
the whole history on every request.

Request body (`application/json`):

```json
{
  "messages": [
    { "role": "user", "content": "why is my loop infinite?" },
    { "role": "tutor", "content": "What condition ends the loop?" },
    { "role": "user", "content": "i < 10" }
  ]
}
```

Validation rules — any violation returns `400 validation_error`:
- `messages` is a non-empty array of at most 50 items.
- `role` is `"user"` or `"tutor"`.
- `content` is a string, non-empty after trimming, at most 8,000 characters.
- The first and the last `message` are from `user`, and roles alternate.

Success: `200 text/event-stream`. The stream is a sequence of SSE events, each with a JSON `data` line:

```
event: delta
data: {"text":"What does "}

event: delta
data: {"text":"the loop condition check?"}

event: done
data: {}
```

| Event | `data` | Meaning |
|---|---|---|
| `delta` | `{ "text": string }` | The next piece of the `tutor` reply. Append in order. |
| `done` | `{}` | The reply finished. The stream then closes. |
| `error` | standard error shape | The reply failed after the stream opened. A `tutor_refused` error always arrives this way, even before any `delta`. The stream then closes. |

A stream ends with exactly one `done` or exactly one `error`, never both.

Failures before streaming starts return JSON in the standard error shape:

| Status | `error.code` | When |
|---|---|---|
| `400` | `validation_error` | The body is malformed, too large, or breaks a validation rule. |
| `429` | `upstream_rate_limited` | The Anthropic API is rate-limiting the proxy. Retry later. |
| `500` | `proxy_misconfigured` | The Anthropic API rejected the proxy's setup: invalid or unauthorized credentials (`401` / `403`), or a request it can't serve, such as an unknown model (`400` / `404`). |
| `500` | `internal_error` | Unexpected proxy failure. |
| `502` | `upstream_unavailable` | The Anthropic API is unreachable or failing. |

Error codes that can arrive in an SSE `error` event:

| `error.code` | When |
|---|---|
| `upstream_unavailable` | The Anthropic stream broke mid-reply. |
| `tutor_refused` | The model declined to answer (`refusal` stop reason). |
| `internal_error` | Unexpected proxy failure mid-reply. |

### Other routes
Any other route returns `404 not_found` in the standard error shape.


