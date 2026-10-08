# System Architecture

## Purpose
- Provide a concise architecture reference for service boundaries, ownership, and major flows.

## System Overview
- In development the runtime is two processes: the `proxy` in `backend/` (Node.js 22.12+,
  TypeScript, ESM, Express 5) and the Next.js frontend in `frontend/`.
- The `proxy` receives a `chat` from the browser, adds the `system prompt`, calls the Anthropic
  Messages API with streaming, and relays the `tutor` reply to the browser as Server-Sent Events (SSE).
- The `proxy` is the only component that holds `ANTHROPIC_API_KEY`.
- The `proxy` is stateless. There is no database; the browser sends the whole `chat` on every request.
- `frontend/` is the browser UI: a Next.js app that calls the `proxy` directly. See [Frontend](#frontend).

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

## Frontend
`frontend/` is a Next.js 16 app (App Router, React 19, TypeScript, Tailwind CSS v4 via
`@tailwindcss/turbopack`). It has one page, no API routes, and no server-side fetch: the browser
calls the `proxy` directly. The `chat` lives only in React state for the page's lifetime.

### Components
All paths are under `frontend/src/`.

| File | Responsibility |
|---|---|
| `app/page.tsx` | Server shell that renders `ChatView`. |
| `app/layout.tsx` | Fonts, metadata, and the `sonner` `<Toaster />`. |
| `app/globals.css` | The only CSS file. Design tokens in `:root` (light and dark), exposed with `@theme inline`; the typography plugin. |
| `components/chat/chat-view.tsx` | Client component. Calls `useChat`, computes `canSend`, and lays out the header, `MessageList`, and `MessageInput`. |
| `components/chat/message-list.tsx` | `role="log"`, `aria-busy` while a reply is pending, the empty state, and auto-scroll to the newest `message`. |
| `components/chat/message-item.tsx` | One `message`. `user` content as plain text; `tutor` content through `TutorMarkdown`, or a loading indicator while the last `tutor` message is still empty. |
| `components/chat/message-input.tsx` | Presentational textarea, send button, character counter, and the full-`chat` notice. Enter sends, Shift+Enter adds a line, and Enter during an IME composition does nothing. |
| `components/chat/tutor-markdown.tsx` | Renders `tutor` content as Markdown (see Markdown safety). |
| `hooks/use-chat.ts` | `useChat()` → `{ messages, status, draft, setDraft, send, isChatFull }`. A reducer moves `status` through `idle → sending → streaming → idle`. |
| `lib/chat.client.ts` | `streamChat(messages, { signal })`: the request to the `proxy` and SSE parsing. |
| `lib/chat-error.ts` | `ChatError { code, requestId? }`, `ChatErrorCode`, and `toastTextFor(code)`. |
| `lib/chat-limit.ts` | The client-side limits and `canSend(chat, draft)`. |
| `lib/config.ts` | `PROXY_URL`. |
| `types/chat.ts` | `ChatRole`, `Message`, `ChatStatus`, `ChatEvent`. |

### Request and stream flow
1. `send()` runs only while `status` is `idle` and `canSend(messages, draft)` is true. It adds the
   `user` message and an empty `tutor` message, clears the draft, and sets `status` to `sending`.
2. `streamChat` sends `POST {PROXY_URL}/api/chat` with the earlier `chat` plus the new `user`
   message, as `{ messages: [{ role, content }] }`. The client-only `id` is not sent, and `content`
   is sent exactly as typed.
3. A `200 text/event-stream` body is read with `fetch` and
   `body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream())`
   (`eventsource-parser`). Each `delta` is appended to the last `tutor` message, and the first one
   sets `status` to `streaming`. `done` returns `status` to `idle`.
4. Every failure becomes a `ChatError`:
   - a non-2xx response → the `error.code` and `requestId` from the standard error shape (an
     unknown code is kept as is; a body that is not that shape → `internal_error`);
   - a 2xx response that is not an event stream → `internal_error`;
   - an SSE `error` event → its code, including `tutor_refused` before any `delta`;
   - a stream that closes without `done` or `error` → `upstream_unavailable`;
   - a rejected `fetch`, or a body read that fails mid-stream → `network_error` (client only);
   - `done` with no reply text → `internal_error`.
5. On any failure, the `chat` is restored to exactly what it was before sending (the unanswered
   `user` message and any partial `tutor` message are removed), the sent text returns to the draft
   only if the draft is still empty, and one toast is shown.
6. Each send creates its own `AbortController`. Unmounting aborts the request in flight; an aborted
   request ends quietly, with no toast. There are no retries.

### Configuration
- `NEXT_PUBLIC_PROXY_URL` sets the `proxy` base URL. It falls back to `http://127.0.0.1:4000` when
  unset or blank, and trailing slashes are removed. It is public (inlined into the browser bundle)
  and never holds a secret. Template: `frontend/.env.example`.
- The backend's CORS matches `FRONTEND_URL` exactly, so the app must be opened at
  `http://localhost:3000`.

### Client-side limits
These mirror the `proxy` validation, so a valid UI never sends a request that returns `400`.
- A send is allowed only while the `chat` has at most 48 `message` items, so a request has at most 49.
  After that, the textarea is disabled and a notice says to reload the page to start a new `chat`.
- A draft must be non-empty after trimming and at most 8,000 characters, measured before trimming
  as the `proxy` does. The counter turns to the `danger` token and announces "Message is too long"
  over the limit.

### Error UX
- One `sonner` toast per failure. Its text comes only from the table in `src/lib/chat-error.ts`
  (one line per contract code, plus `network_error`); an unknown code gets the `internal_error`
  text. The server's `error.message` is never shown.
- When present, the `requestId` appears in the toast description as `Request ID: <id>`.
- Toasts never contain `message` content.

### Markdown safety
`tutor` output is untrusted. `TutorMarkdown` uses `react-markdown` with `remark-gfm`:
- No `dangerouslySetInnerHTML` and no raw-HTML plugin. Raw HTML in a reply is shown as literal text.
- `img` is a disallowed element, so images (Markdown or HTML) are dropped and the browser never
  calls a third-party host.
- The default `urlTransform` stays, so a `javascript:` link gets no such `href`. Links open with
  `target="_blank"` and `rel="noopener noreferrer"`.
- Code renders as plain `<pre><code>` styled by `@tailwindcss/typography`, without syntax highlighting.

### Testing
- Vitest + React Testing Library + jsdom, in `frontend/tests/unit/` (`cd frontend && npm test`).
  The tests never call the network.
- `tests/unit/helpers/controlled-sse-response.ts` returns a `Response` whose SSE body the test
  writes by hand (`push`, `close`, `error`), so streaming tests release each chunk explicitly
  instead of relying on timers.
- `tests/unit/chat-view.test.tsx` renders `ChatView` with `<Toaster />` and a stubbed `fetch`. It
  covers streaming (AC02), failures (AC03), and that every request goes to `PROXY_URL` only (AC06).

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

`error.details` appears only on `validation_error`, in one of two shapes:
- The body breaks a validation rule: `{ "issues": [{ "path": "messages.1.role", "message": "must be \"user\" or \"tutor\"" }] }`.
  `path` is the dotted path to the invalid field, or `(body)` when the body is not a JSON object.
  `message` describes the problem and never repeats the user's content.
- The body could not be read: `{ "reason": "malformed_json" | "body_too_large" | "unreadable_body" }`.
  `body_too_large` means over 2 MB. `unreadable_body` covers an unsupported charset or encoding.

Error bodies never
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
  So a valid `chat` always has an odd number of `message` items, and the longest valid `chat`
  has 49, not 50.

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
