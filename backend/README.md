# AI Tutor backend

The `proxy` between the browser and the Anthropic API. It adds the `tutor` `system prompt`
and streams the reply as Server-Sent Events. The API key stays here.

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
| `ANTHROPIC_MODEL` | no | `claude-haiku-4-5` | Model for `tutor` replies. |

`.env` is gitignored. Never commit it or paste its values anywhere. If a required variable is
missing or invalid, the server prints which one and exits with code 1.

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

Any other route returns `404`. Error bodies use the standard error shape described in the API contract.

Check that the server is up:

```powershell
curl.exe -i http://127.0.0.1:4000/api/health
```

Send a `chat` from the manual test fixture and watch the reply stream:

```powershell
curl.exe -N -X POST http://127.0.0.1:4000/api/chat -H "Content-Type: application/json" --data-binary "@tests/fixtures/smoke-chat.json"
```

This sends a real request to Anthropic and uses API credit.
