# AI Tutor backend

The `proxy` between the browser and the Anthropic API. It adds the `tutor` `system prompt`
and streams the reply as Server-Sent Events. It also builds a `quiz` from the `chat` with one
non-streaming call. The API key stays here.

Architecture and the full API contract: [`.doc/architecture.md`](../.doc/architecture.md).

## Requirements
- Node.js 22.12 or later.
- An Anthropic API key.

## Install
```powershell
cd backend
npm ci
```

## Configure
Create `backend/.env` from the template, then fill in your values in an editor:

```powershell
Copy-Item .env.example .env
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes | — | Anthropic API key. Used only by the `proxy`. |
| `FRONTEND_URL` | yes | — | The only origin allowed by CORS. |
| `PORT` | no | `4000` | Port on `127.0.0.1`. |
| `ANTHROPIC_MODEL` | no | `claude-sonnet-5-5` | Model for `tutor` replies and for the `quiz`. |

`.env` is gitignored. Never commit it or paste its values anywhere. If a required variable is
missing or invalid, the server prints which one and exits with code 1.

`ANTHROPIC_MODEL` also changes the `quiz` model; both routes use the same model, with no code
change. The default is `claude-sonnet-5-5` because, in manual runs, `quiz` quality was better on it
than on the previous default.

## Run
| Command | What it does |
|---|---|
| `npm run dev` | Runs `src/index.ts` with `tsx watch`, reading `.env`. |
| `npm run build` | Compiles `src/` to `dist/`. |
| `npm start` | Runs `dist/index.js`, reading `.env`. Run `npm run build` first. |
| `npm test` | Runs the unit and integration tests. They mock the Anthropic client and need no network or API key. |
| `npm run typecheck` | Runs `tsc --noEmit`. |

The server listens on `http://127.0.0.1:4000` by default.

## Routes
| Route | Description |
|---|---|
| `GET /api/health` | Returns `200 { "status": "ok" }`. |
| `POST /api/chat` | Takes `{ "messages": [{ "role": "user" \| "tutor", "content": string }] }` and streams the reply as SSE events `delta`, `done`, and `error`. |
| `POST /api/quiz` | Takes the same body as `/api/chat`, but the last `message` must be from `tutor`. Returns `200 { "quiz": { "questions": [...] } }` with 5 questions of 4 options each, as one JSON response. |

Any other route returns `404`. Error bodies use the standard error shape described in the API contract.

Check that the server is up:

```powershell
curl.exe -i http://127.0.0.1:4000/api/health
```

Send a `chat` from the manual test fixture and watch the reply stream:

```powershell
curl.exe -N -X POST http://127.0.0.1:4000/api/chat -H "Content-Type: application/json" --data-binary "@tests/fixtures/smoke-chat.json"
```

Build a `quiz` from the quiz fixture (a short `chat` about `for` and `while` loops):

```powershell
curl.exe -i -X POST http://127.0.0.1:4000/api/quiz -H "Content-Type: application/json" --data-binary "@tests/fixtures/smoke-quiz.json"
```

It returns `200` with 5 questions about the fixture's topic. Both commands send a real request to
Anthropic and use API credit; one `quiz` request can make up to 2 model calls.

## Known limitations
The models sometimes return words glued together inside sentences (for example "countertoward"),
mostly in the `quiz` `explanation`. It is not caused by this app, and the app does not repair the
text. Details: Operational Concerns in [`.doc/architecture.md`](../.doc/architecture.md).
