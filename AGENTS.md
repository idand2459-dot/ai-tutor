# Agent Instructions

## communication with me
- Please start all your responses with Hopa!

## Security
- Never commit or expose secrets (tokens, API keys, passwords, cluster credentials, secret values).

## Guardrails (Single Source of Truth)
- Guardrail logic lives in `.claude/hooks/`. It is wired into the runtime by
  `.claude/settings.json`, which is the only location Claude Code reads hook and
  permission config from — a hook script that is not listed there never runs.
- Do not duplicate permission or hook rules in other agent docs.
- If any instruction conflicts with the hooks, the hooks win.
- `dev-loop.js` sets `AGENT_ROLE` when it spawns a sub-agent; that is what
  `.claude/hooks/enforce-agent-boundaries.js` uses to enforce per-role write paths.

## Repository Layout
- `.doc/` — hand-written product and architecture docs.
- `.claude/rules/` — always-on constraints, imported below. Short by design.
- `.claude/skills/` — procedural know-how, loaded on demand by task.
- `.claude/agents/` — sub-agent definitions used by the dev loop.
- `.claude/hooks/` — guardrail hook implementations, wired by `.claude/settings.json`.
- `.plan/` — `000-backlog.md` is the task queue; `NNN-YYYY-MM-DD-*.md` are the plans.
- `.orchestrate/` — everything the dev loop generates (plan mirror, tickets, agent
  reports, QA report, API contract, cost traces). Never create a `docs/` directory.
- `frontend/` — the Next.js app. `backend/` does not exist yet and is only created by a
  task explicitly marked `stack:full`.

## Rules — always in context
@.claude/rules/code-style.md
@.claude/rules/naming.md
@.claude/rules/ui-and-styling.md
@.claude/rules/git-workflow.md

## Skills — load when the task calls for it
| Skill | Use it when |
|---|---|
| `writing-plans` | Creating, revising, or superseding a plan in `.plan/` |
| `writing-tests` | Adding or reviewing unit, integration, or e2e tests |
| `error-handling` | Shaping an error response, status code, retry, or failure UX |
| `database-schema` | Adding or changing a table, column, index, or migration |
| `cutting-a-release` | Choosing a version number or tagging a release |

## Product and Domain
- Product definition and acceptance criteria: `.doc/product-definition.md`.
- Architecture overview: `.doc/architecture.md`.
- Canonical domain terms: `.doc/glossary.md` — document a new shared term there
  before using it broadly.
- Keep these docs updated when API routes, auth/org boundaries, or schema/migrations change.
