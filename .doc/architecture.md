# System Architecture

## Purpose
- Provide a concise architecture reference for service boundaries, ownership, and major flows.

## System Overview
- This document should describe the primary runtime components and how they interact.

## Recommended Sections

- `Primary Components`
	- Main services/modules and their responsibilities.
- `Data Flow`
	- Request and event flow between components.
- `Auth`
	- Where authentication is enforced.
- `External Dependencies`
	- Third-party services and integration points.
- `Operational Concerns`
	- Logging, monitoring, retries, and failure handling.
- `Change Log`
	- Date-stamped notes for major architecture updates.

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
| `error` | standard error shape | The reply failed after streaming started. The stream then closes. |

A stream ends with exactly one `done` or exactly one `error`, never both.

Failures before streaming starts return JSON in the standard error shape:

| Status | `error.code` | When |
|---|---|---|
| `400` | `validation_error` | The body is malformed, too large, or breaks a validation rule. |
| `429` | `upstream_rate_limited` | The Anthropic API is rate-limiting the proxy. Retry later. |
| `500` | `proxy_misconfigured` | The proxy's Anthropic credentials are missing or rejected. |
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


