# System Architecture

## Purpose
- Provide a concise architecture reference for service boundaries, ownership, and major flows.

## System Overview
- In development the runtime is two processes: the `proxy` in `backend/` (Node.js 22.12+,
  TypeScript, ESM, Express 5) and the Next.js frontend in `frontend/`.
- The `proxy` receives a `chat` from the browser, adds the `system prompt`, calls the Anthropic
  Messages API with streaming, and relays the `tutor` reply to the browser as Server-Sent Events (SSE).
- The `proxy` also builds a `quiz` from the `chat` with a single non-streaming call, returned as one
  JSON response.
- The `proxy` is the only component that holds `ANTHROPIC_API_KEY`.
- The `proxy` is stateless. There is no database; the browser sends the whole `chat` on every request.
- `frontend/` is the browser UI: a Next.js app that calls the `proxy` directly. See [Frontend](#frontend).

## Primary Components
All paths are under `backend/src/`.

| File | Responsibility |
|---|---|
| `index.ts` | Entry point. Loads config, builds the Anthropic client with the API key, and listens on `127.0.0.1:PORT`. Exits with code 1 on invalid config. |
| `app.ts` | `createApp({ client, config, log? })`. Wires the request id, CORS, the JSON body parser (2 MB limit), the routes (mounts `/api/chat` and `/api/quiz`), the 404 handler, and the final error handler. Receives the Anthropic client from the caller and never sees the API key. The client needs `messages.stream` (for `/api/chat`) and `messages.create` (for `/api/quiz`). |
| `route/chat.ts` | `POST /api/chat`. Validates the body, streams the `tutor` reply as SSE, maps errors to the contract codes, aborts the upstream request when the client disconnects, and logs failures. Exports `mapChatError`, which `route/quiz.ts` reuses for SDK errors. |
| `route/quiz.ts` | `POST /api/quiz`. Validates the body, calls the quiz service, returns `200 { quiz }`, maps `QuizMalformedError` to `502 quiz_malformed` and `TutorRefusedError` to `422 tutor_refused` (everything else through `mapChatError`), aborts the upstream request when the client disconnects (same `res.on('close')` rule as chat), and logs failures and a retry that succeeded. |
| `lib/config.ts` | Reads and validates `ANTHROPIC_API_KEY`, `FRONTEND_URL`, `PORT`, and `ANTHROPIC_MODEL`. Error messages name variables, never values. |
| `lib/chat-request.ts` | Request body schema (zod) and `validateChatRequest`. Exports `messageSchema` and the limits for reuse by the quiz request. |
| `lib/chat.service.ts` | Maps `tutor` to the Anthropic role `assistant`, calls `client.messages.stream`, yields reply text, throws `TutorRefusedError` on a `refusal` stop reason, and exposes `abort()`. |
| `lib/system-prompt.ts` | `SYSTEM_PROMPT`, the `system prompt` sent with every chat request. |
| `lib/quiz-request.ts` | `quizRequestSchema` (zod) and `validateQuizRequest`: the chat `message` rules, but the last `message` must be from `tutor`. Returns the same `{ success, issues }` shape as `validateChatRequest`. |
| `lib/quiz-schema.ts` | `quizSchema` (zod, strict), the real gate for the model output and the `200` body; `QUIZ_JSON_SCHEMA`, the hand-written JSON Schema sent as `output_config.format.schema`; the `Quiz` and `Question` types. |
| `lib/quiz.service.ts` | `toQuizTranscript` (the escaped transcript) and `createQuizService({ client, model, random? })`. `generateQuiz(messages, { signal })` calls `client.messages.create` at most twice, classifies each response (valid, malformed, or refusal), shuffles the options, and returns `{ quiz, attempts }`. Throws `QuizMalformedError` (with the attempt count) or `TutorRefusedError`; SDK errors pass through unretried. |
| `lib/quiz-system-prompt.ts` | `QUIZ_SYSTEM_PROMPT`, the `system` sent with every quiz request instead of `SYSTEM_PROMPT`. |
| `lib/http-error.ts` | The standard error shape and `sendError`. |

## Data Flow
`POST /api/chat`:
1. `app.ts` assigns a random UUID request id, sets `X-Request-Id`, applies CORS, and parses the JSON body.
   An unreadable or oversized body ends here with `400 validation_error`.
2. `route/chat.ts` validates the body. A violation ends here with `400 validation_error`; no
   request reaches Anthropic.
3. `chat.service.ts` sends `model`, `max_tokens: 4096`, `system`, and the mapped `messages` to
   `client.messages.stream`. The chat request sends no `thinking` and no `output_config`
   (only the quiz request uses `output_config`).
4. The route waits for the first piece of reply text before it sends headers. A failure at this
   point returns a JSON error with a real HTTP status.
5. The route sends `200 text/event-stream`, one `delta` event per text piece, then `done`.
   A failure after this point sends one `error` event instead of `done`.
6. If the client disconnects before the reply ends, the route calls `abort()` and stops writing.

`POST /api/quiz`:
1. `app.ts` handles the request id, CORS, and the JSON body exactly as for `/api/chat`.
2. `route/quiz.ts` validates the body with `validateQuizRequest`. A violation ends here with
   `400 validation_error`; no request reaches Anthropic.
3. `quiz.service.ts` builds one `user` message from the `chat` with `toQuizTranscript`:
   `JSON.stringify` of `[{ role, content }]`, then every `<` in that JSON text is replaced with the
   six characters `\u003c`, then the result is wrapped in `<chat>` … `</chat>` and followed by the
   fixed line "Write the quiz from the chat above." The escaping is needed because `JSON.stringify`
   leaves `<` as it is, so a `message` containing `</chat>` would close the block. After escaping, the
   JSON is still valid and parses back to the original content, and the only raw `<` in the
   transcript are the two tags the code adds. The `chat` is not replayed as turns, so the model reads
   it as data instead of continuing it.
4. The service calls `client.messages.create` with `model`, `max_tokens: 4096`,
   `system: QUIZ_SYSTEM_PROMPT`, `output_config: { format: { type: "json_schema", schema: QUIZ_JSON_SCHEMA } }`,
   and that one message, with a 60-second timeout and the route's abort signal. It sends no
   `thinking`, `tools`, `temperature`, or `effort`.
5. Each response is classified. `stop_reason: "refusal"` → `TutorRefusedError`, not retried.
   Otherwise the text blocks are joined, `JSON.parse`d, and checked with `quizSchema` (zod). A
   `max_tokens` stop, no text, text that is not JSON, or JSON that fails `quizSchema` counts as
   malformed.
6. On malformed output the service retries once with the identical request. If the second response
   is also malformed, it throws `QuizMalformedError` → `502 quiz_malformed`. SDK errors are thrown as
   they are, never retried by the service.
7. On a valid response the service shuffles each `question`'s `options` (Fisher-Yates) and moves
   `correctOption` with the correct `option`.
8. The route returns `200 { quiz }`. If the client disconnected first, it aborts the upstream request
   and writes nothing.

`GET /api/health` returns `{ "status": "ok" }` without calling Anthropic.

## Frontend
`frontend/` is a Next.js 16 app (App Router, React 19, TypeScript, Tailwind CSS v4 via
`@tailwindcss/turbopack`). It has one page, no API routes, and no server-side fetch: the browser
calls the `proxy` directly. The `chat` lives only in React state for the page's lifetime, and so
does the `quiz`.

### Components
All paths are under `frontend/src/`.

| File | Responsibility |
|---|---|
| `app/page.tsx` | Server shell that renders `ChatView`. |
| `app/layout.tsx` | Fonts, metadata, and the `sonner` `<Toaster />`. |
| `app/globals.css` | The only CSS file. Design tokens in `:root` (light and dark), exposed with `@theme inline`; the typography plugin. `--success` marks a right quiz answer, as `--danger` marks errors. |
| `components/chat/chat-view.tsx` | Client component. Calls `useChat` and `useQuiz`, computes `canSend` (false while a `quiz` is generating) and `canGenerateQuiz`, and lays out the header with `GenerateQuizButton`. Shows `QuizView` while a `quiz` is open, otherwise `MessageList` and `MessageInput`. |
| `components/chat/message-list.tsx` | `role="log"`, `aria-busy` while a reply is pending, the empty state, and auto-scroll to the newest `message`. |
| `components/chat/message-item.tsx` | One `message`. `user` content as plain text; `tutor` content through `TutorMarkdown`, or a loading indicator while the last `tutor` message is still empty. |
| `components/chat/message-input.tsx` | Presentational textarea, send button, character counter, and the full-`chat` notice. Enter sends, Shift+Enter adds a line, and Enter during an IME composition does nothing. |
| `components/chat/tutor-markdown.tsx` | Renders `tutor` content as Markdown (see Markdown safety). |
| `components/quiz/generate-quiz-button.tsx` | Presentational "Generate Quiz" button (`ListChecks` icon). While generating it shows a `Loader2` spinner, `aria-busy`, and hidden "Generating quiz" text. |
| `components/quiz/quiz-view.tsx` | Presentational quiz view: heading, "Back to chat", the score line "You got N of 5 right." (focused after checking), one `QuizQuestion` per `question`, and "Check answers" / "Retake quiz". |
| `components/quiz/quiz-question.tsx` | One `question` as a `fieldset` of 4 native radios, named by the `question` text through `aria-labelledby` (not a `legend`, because `TutorMarkdown` renders block elements). After checking: `Check` / `X` icon plus "Correct" / "Incorrect", "Correct answer" and "Your answer" marks, and the `explanation`. `question` text and `explanation` go through `TutorMarkdown`; `option` text is plain text. |
| `hooks/use-chat.ts` | `useChat()` → `{ messages, status, draft, setDraft, send, isChatFull }`. A reducer moves `status` through `idle → sending → streaming → idle`. |
| `hooks/use-quiz.ts` | `useQuiz()` → `{ status, quiz, answers, isChecked, canCheck, score, generate, select, check, retake, close }`. `status` is `idle` or `generating`. One request at a time; aborts on unmount; one toast per failure. |
| `lib/chat.client.ts` | `streamChat(messages, { signal })`: the request to the `proxy` and SSE parsing. Exports `readErrorResponse`, the standard-error-shape reader that `quiz.client.ts` reuses. |
| `lib/quiz.client.ts` | `generateQuiz(messages, { signal })` → `Quiz`, or `null` when the signal aborts. Throws a `ChatError` on every other failure. Never retries. |
| `lib/chat-error.ts` | `ChatError { code, requestId? }`, `ChatErrorCode` (includes `quiz_malformed`), and `toastTextFor(code)`. The chat toast table is typed with `ChatToastCode` (`ChatErrorCode` without `quiz_malformed`), so `quiz_malformed` has no chat text and falls back to the `internal_error` text. |
| `lib/quiz-error.ts` | The quiz toast table and `quizToastTextFor(code)`. |
| `lib/chat-limit.ts` | The client-side limits, `canSend(chat, draft)`, and `canGenerateQuiz(chat, status)`. |
| `lib/config.ts` | `PROXY_URL`. |
| `types/chat.ts` | `ChatRole`, `Message`, `ChatStatus`, `ChatEvent`. |
| `types/quiz.ts` | `Question`, `Quiz`, `QuizStatus`. |

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

### Quiz flow
1. "Generate Quiz" is enabled only when `canGenerateQuiz(messages, status)` is true (chat `status`
   is `idle`, at least 2 `message` items, the last from `tutor` with non-empty content) and no `quiz`
   is being generated.
2. `generate()` discards any open `quiz`, sets `status` to `generating`, and `generateQuiz` sends
   `POST {PROXY_URL}/api/quiz` with `{ messages: [{ role, content }] }` (no client-only `id`).
   While generating, sending a `message` is disabled, so the `chat` cannot change under the request.
3. A `200` body is checked with a small type guard: exactly 5 `questions`, each with a string
   `text`, exactly 4 string `options`, an integer `correctOption` from 0 to 3, and a string
   `explanation`. Only those fields are copied. A body that fails the guard → `internal_error`.
4. Other failures map as in the chat client: a non-2xx response → its `error.code` and `requestId`
   (through `readErrorResponse`); a rejected `fetch` or a failed body read → `network_error`.
   An abort makes `generateQuiz` return `null` with no error, and the hook stops quietly, with no toast.
5. On success the quiz view replaces the message list and the input. The user picks one `option`
   per `question`; "Check answers" is enabled once all 5 are answered. After checking, the radios are
   disabled and each `question` shows its result and `explanation`. "Retake quiz" clears the answers
   for the same `quiz`; "Back to chat" closes it and the `chat` and draft come back unchanged.
6. On failure: one toast, the view stays on the chat, and the `chat` and the draft are unchanged.

Quiz toast texts (from `src/lib/quiz-error.ts`; an unknown code gets the `internal_error` text):

| Code | Toast |
|---|---|
| `validation_error` | "This chat can't be turned into a quiz. Reload the page to start a new chat." |
| `upstream_rate_limited` | "The tutor is busy. Wait a moment, then generate the quiz again." |
| `proxy_misconfigured` | "The proxy isn't set up correctly. Check the backend API key and model." |
| `upstream_unavailable` | "The tutor is unreachable right now. Generate the quiz again in a moment." |
| `tutor_refused` | "The tutor declined to build a quiz from this chat." |
| `quiz_malformed` | "The tutor couldn't build a valid quiz. Generate it again." |
| `internal_error` | "The proxy hit an unexpected error. Generate the quiz again." |
| `network_error` (client only) | "Can't reach the proxy. Is the backend running on port 4000?" |

As with chat failures, the `requestId` appears in the toast description as `Request ID: <id>`, and
the server's `error.message` is never shown.

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
  (one line per contract code except `quiz_malformed`, plus `network_error`); an unknown code, and
  `quiz_malformed`, get the `internal_error` text. Quiz failures use their own table (see Quiz flow).
  The server's `error.message` is never shown.
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
- Anthropic Messages API, through `@anthropic-ai/sdk`: `client.messages.stream` for `/api/chat`, and
  `client.messages.create` with structured outputs (`output_config.format` of type `json_schema`)
  for `/api/quiz`. Structured outputs do not enforce array lengths or number ranges, so `quizSchema`
  enforces the counts and the index range.
- Model: `claude-haiku-4-5` unless `ANTHROPIC_MODEL` is set. Both routes use the same model.
- The client is built with SDK defaults: up to 2 retries on connection errors, 408, 409, 429, and
  5xx, and a 10-minute timeout. The quiz request overrides the timeout to 60 seconds. The `proxy`
  adds no retries for these errors; its only retry is the quiz retry for malformed output.

## Operational Concerns
- Logging: one JSON line per failure on stderr. A successful request logs nothing.
  - `chat` failures: `level`, `requestId`, `operation`, `status` (the HTTP status the client got:
    `200` once the stream has started), `code`, `phase` (`before_stream` or `mid_stream`), and
    `upstreamError` (the error class name).
  - `quiz` failures: `level`, `requestId`, `operation: "quiz"`, `status` (the HTTP status the client
    got), `code`, `attempts` (only on `quiz_malformed`: `2`), `phase` (always `before_response`,
    because there is no stream), and `upstreamError` (the error class name).
  - `quiz` retry that succeeded: one `warn` line with `operation: "quiz"`, `status: 200`,
    `code: "quiz_malformed"`, `attempts: 2`, and `phase: "before_response"`, and no `upstreamError`.
    It shows that the first attempt was malformed.
  - Unexpected errors in the final error handler: `level`, `requestId`, `operation: "http"`,
    `status: 500`, `code`, and `errorType`.
  - Startup: one JSON line on stdout with the address and the model.
  - Logs never contain `message` content, request headers, provider error messages, or the API key.
- Failure handling: see the error tables in the API Contract. Refusals and rate limits log at
  `warn`; everything else at `error`. Errors after the stream starts are not retried.
- Quiz retry rule: a quiz request is retried exactly once, and only when the model output is
  malformed (a `max_tokens` stop, no text, text that is not JSON, or JSON that fails `quizSchema`).
  Model output is non-deterministic and structured outputs cannot enforce the counts, so a single
  miss is often fixed by asking again; AC04 requires that one retry. Validation errors, refusals, and
  SDK errors are never retried by the `proxy` (the SDK's own transport retries still apply).
- Limits: 2 MB request body, 50 `message` items, 8,000 characters per `message`, and 4,096 output tokens.
  A quiz request also has a 60-second timeout per model call and makes at most 2 model calls.
- Monitoring: `GET /api/health` only.
- Model choice: in manual runs, quiz quality was better on `claude-sonnet-5-5` than on
  `claude-haiku-4-5`. The default stays `claude-haiku-4-5`. Setting `ANTHROPIC_MODEL` in
  `backend/.env` changes the model for both routes with no code change.
- Known limitations: `claude-haiku-4-5`, `claude-sonnet-5-5`, and `claude-opus-5-5` sometimes return
  words glued together inside sentences (for example "countertoward"), mostly in the `explanation`
  field. This was observed with and without structured outputs, with and without streaming, and with
  different system prompts, so it is not caused by this app. The app does not try to repair the text.

## API Contract
The contract between `frontend/` and the `backend/` proxy. This section is the only copy;
there is no `.orchestrate/api-contract.yaml`. Source plans: `.plan/001-2026-10-08-chat-proxy.md`,
and `.plan/003-2026-10-09-quiz-generation.md` for `POST /api/quiz`.

### Conventions
- Base URL in development: `http://127.0.0.1:4000`. The proxy binds to `127.0.0.1` only.
- CORS allows only the origin in `FRONTEND_URL`.
- Every response carries an `X-Request-Id` header. Error bodies repeat it as `requestId`.
- Statuses used by the contract: `200`, `400`, `404`, `422`, `429`, `500`, and `502`. `422` is used
  only by `POST /api/quiz`, for `tutor_refused`.
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

### `POST /api/quiz`
Sends the full `chat` and returns a `quiz` built from it, as one JSON response. There is no
streaming. The proxy is stateless and saves nothing.

Request body (`application/json`), the same shape as `POST /api/chat`:

```json
{
  "messages": [
    { "role": "user", "content": "why is my loop infinite?" },
    { "role": "tutor", "content": "What condition ends the loop?" }
  ]
}
```

Validation rules — any violation returns `400 validation_error`, with `error.details` as described in Conventions:
- `messages` is a non-empty array of at most 50 items.
- `role` is `"user"` or `"tutor"`.
- `content` is a string, non-empty after trimming, at most 8,000 characters.
- The first `message` is from `user`, and roles alternate.
- **The last `message` is from `tutor`**, unlike `POST /api/chat`, whose last `message` must be from
  `user`. So a valid `chat` holds at least one full exchange, always has an even number of
  `message` items, and has at least 2 and at most 50.

Success: `200 application/json`:

```json
{
  "quiz": {
    "questions": [
      {
        "text": "What ends a `for` loop?",
        "options": ["...", "...", "...", "..."],
        "correctOption": 2,
        "explanation": "The loop stops when its condition becomes false."
      }
    ]
  }
}
```

Field rules (enforced by `quizSchema` before the response is sent):
- `questions` has exactly 5 items.
- `text`: a string, non-empty after trimming, at most 500 characters.
- `options`: exactly 4 strings, each non-empty after trimming, at most 200 characters, and no two
  equal after trimming and lowercasing.
- `correctOption`: an integer from 0 to 3, the index of the `correct option` in `options`. One index
  means exactly one `correct option`. The proxy shuffles `options` before sending, so the position
  carries no pattern.
- `explanation`: a string, non-empty after trimming, at most 500 characters.
- No other fields, at any level.

All strings are model output. Treat them as untrusted text.

Failures return JSON in the standard error shape with a real HTTP status. Unlike `/api/chat`,
`tutor_refused` arrives here as a JSON `422`, not as an SSE `error` event:

| Status | `error.code` | When |
|---|---|---|
| `400` | `validation_error` | The body is malformed, too large, or breaks a validation rule (including an empty `chat` and a `chat` that ends with `user`). |
| `422` | `tutor_refused` | The model declined to write the quiz (`refusal` stop reason). Not retried. |
| `429` | `upstream_rate_limited` | The Anthropic API is rate-limiting the proxy. Retry later. |
| `500` | `proxy_misconfigured` | The Anthropic API rejected the proxy's setup (`400` / `401` / `403` / `404`), including a model without structured outputs. |
| `500` | `internal_error` | Unexpected proxy failure. |
| `502` | `quiz_malformed` | The model output was malformed on both attempts (the proxy retries once). |
| `502` | `upstream_unavailable` | The Anthropic API is unreachable or failing. |

### Other routes
Any other route returns `404 not_found` in the standard error shape.
