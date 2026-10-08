# AI Tutor frontend

The browser UI for the `chat`: a Next.js app that sends the `chat` to the `proxy` in `backend/`
and renders the `tutor` reply as it streams. It never holds the Anthropic API key.

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

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Starts the dev server on port 3000. |
| `npm run build` | Builds the production bundle into `.next/`. |
| `npm start` | Serves the production build. Run `npm run build` first. |
| `npm run lint` | Runs ESLint. |
| `npm run typecheck` | Generates the Next.js route types, then runs `tsc --noEmit`. |
| `npm test` | Runs the Vitest + Testing Library suite in `tests/unit/`. It stubs `fetch` and needs no backend. |

## Not in V1
- Playwright e2e tests.
- Syntax highlighting in code blocks.
- A "stop generating" button.
- A "new chat" button (reload the page instead).
- Saving the `chat` between page loads.
- Smarter auto-scroll (the list always scrolls to the newest `message`, even if you scrolled up).
