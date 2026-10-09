# AI Tutor frontend

The browser UI for the `chat`: a Next.js app that sends the `chat` to the `proxy` in `backend/`
and renders the `tutor` reply as it streams. It can also build a `quiz` from the `chat`. It never
holds the Anthropic API key.

Architecture, the request flow, and the API contract: [`.doc/architecture.md`](../.doc/architecture.md).

## Requirements
- Node.js 22.12 or later.
- The `proxy` in `backend/`, running on `http://127.0.0.1:4000`, to get real replies.

## Install
```powershell
cd frontend
npm ci
```

## Configure
No env file is needed for local development. The app calls `http://127.0.0.1:4000` by default.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_PROXY_URL` | no | `http://127.0.0.1:4000` | Base URL of the `proxy`. |

`NEXT_PUBLIC_*` values are inlined into the browser bundle. Never put a secret in one.
`.env.example` is the template.

## Run
```powershell
npm run dev
```

Open **http://localhost:3000**, not `http://127.0.0.1:3000`. The backend's CORS allows only the
origin in its `FRONTEND_URL` (`http://localhost:3000` in `backend/.env.example`) and matches it
exactly. From any other origin, every send fails with "Can't reach the proxy."

### Backend and frontend together
Use two terminals. The backend needs `backend/.env` with your API key (see `backend/README.md`).

```powershell
# Terminal 1
cd backend
npm run dev
```

```powershell
# Terminal 2
cd frontend
npm run dev
```

Then open http://localhost:3000.

## Generate Quiz
- The "Generate Quiz" button in the header is enabled once the `chat` has a full exchange (the last
  `message` is a finished `tutor` reply) and no reply is streaming.
- Clicking it sends the whole `chat` to `POST /api/quiz`. While the `quiz` is generated, the button
  shows a spinner and sending a new `message` is disabled.
- The quiz view replaces the `chat`: pick one `option` per `question`, then "Check answers" shows
  the score, the `correct option`, and an `explanation` for each `question`. "Retake quiz" clears
  the answers and moves focus to the first option of question 1, and "Back to chat" returns to the
  `chat` and the draft unchanged.
- `option` text is plain text; only inline code in single backticks (for example `` `map()` ``)
  renders as code.
- On a failure, one toast is shown and the `chat` and the draft stay as they were.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Starts the dev server on port 3000. |
| `npm run build` | Builds the production bundle into `.next/`. |
| `npm start` | Serves the production build. Run `npm run build` first. |
| `npm run lint` | Runs ESLint. |
| `npm run typecheck` | Generates the Next.js route types, then runs `tsc --noEmit`. |
| `npm test` | Runs the Vitest + Testing Library suite in `tests/unit/`. It stubs `fetch` and needs no backend. |

### Quiz tests
All under `tests/unit/`:

| File | Covers |
|---|---|
| `quiz.client.test.ts` | `generateQuiz`: the request, the response check, error mapping, and abort. |
| `quiz-error.test.ts` | The quiz toast texts, the fallback for an unknown code, and the chat fallback for `quiz_malformed`. |
| `use-quiz.test.ts` | `useQuiz`: generating, answering, checking, retaking, closing, and failure toasts. |
| `quiz-view.test.tsx` | The quiz view: radios, "Check answers", results, explanations, "Retake quiz" and the focus after it, and inline code in options. |
| `inline-code.test.ts` | `splitInlineCode`: code spans, and the backtick cases that stay literal. |
| `chat-view-quiz.test.tsx` | `ChatView` with quizzes: the "Generate Quiz" button state (AC07), the switch between the `chat` and the quiz view, failure toasts, and that every request goes to the `proxy` only (AC06). |
| `helpers/controlled-json-response.ts` | A `fetch` result the test settles by hand, so loading states can be checked without timers. |

## Not in V1
- Playwright e2e tests.
- Syntax highlighting in code blocks.
- A "stop generating" button.
- A "new chat" button (reload the page instead).
- Saving the `chat` between page loads.
- Smarter auto-scroll (the list always scrolls to the newest `message`, even if you scrolled up).
