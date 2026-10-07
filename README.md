# AI4Dev Agent Files

A structured workspace for running an AI-driven product development loop.

This repository holds the source-of-truth instructions, product docs, planning artifacts, and orchestration outputs used to build a frontend-first social app MVP through specialized agents.

## What this repository is

- A coordination and governance repo for multi-agent delivery
- A place to keep product intent, architecture notes, backlog, and implementation plans aligned
- A contract handoff point for future backend implementation

## Current project focus

- Product: TBD
- Scope: Frontend-first, mock-data-driven user journeys
- Delivery model: Orchestrator -> Frontend/Backend (when needed) -> QA

See the product definition in .doc/product-definition.md.

## Repository map

| Path | Purpose |
|---|---|
| AGENTS.md | Canonical operating rules and guardrails for all agents |
| CLAUDE.md | Loads AGENTS.md into compatible runtimes |
| .doc/ | Product and architecture source docs |
| .plan/ | Prioritized backlog and approved implementation plans |
| .claude/rules/ | Always-on coding and workflow constraints |
| .claude/skills/ | On-demand procedural playbooks |
| .claude/agents/ | Role definitions for orchestrator, frontend, backend, qa, and security-reviewer |
| .claude/hooks/ | Runtime guardrails that enforce boundaries and safety |
| .orchestrate/ | Generated outputs from the latest dev-loop run |
| .github/copilot-instructions.md | Copilot entry point that points to AGENTS.md |

## How work moves through this repo

1. Add or prioritize tasks in .plan/000-backlog.md.
2. Create or update an implementation plan in .plan/NNN-YYYY-MM-DD-topic.md.
3. Execute the dev loop in your local environment.
4. Review generated artifacts in .orchestrate/:
   - PLAN.md mirror
   - api-contract.yaml
   - agent reports
   - qa-report.md
   - trace.json
5. Validate acceptance criteria against .doc/product-definition.md.

## Source of truth and generated files

- Durable, hand-maintained sources:
  - .doc/
  - .plan/
  - .claude/rules/
  - .claude/skills/
  - AGENTS.md
- Generated, disposable artifacts:
  - .orchestrate/* (except .orchestrate/README.md, which documents the folder)

