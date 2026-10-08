# Git Workflow

## Approval gates — no exceptions
- Never run `git commit`, `git merge`, `git push`, or `git tag` yourself. The guardrail hook blocks them.
- Prepare the work instead: stage changes with `git add` and propose the commit message. The user runs the command.

## Branches
- Do implementation work on a dedicated branch, never on `main`.
- Create the branch before executing an approved plan.
- One plan or workstream per branch.
- Lowercase, predictable names, singular domain terms:
  - `feat/<topic>` — new capability
  - `fix/<topic>` — bug fix
  - `chore/<topic>` — maintenance
  - `docs/<topic>` — documentation only

## Commits
- Imperative subject, concise and action-oriented: `add quiz schema validation`.
- One intent per commit. Do not bundle unrelated changes.

## Merges
- At least one review pass before merge when others are involved.
- Resolve open comments and questions before merging.
