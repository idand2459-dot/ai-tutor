#!/usr/bin/env node
// PreToolUse guardrail: enforces the "Allowed paths" sections already written
// in .claude/agents/frontend.md, backend.md and qa.md. Those files only *ask*
// the agent to stay in its lane ("Forbidden: backend/**") - nothing stopped it
// from ignoring that under bypassPermissions. This hook reads the AGENT_ROLE
// env var that dev-loop.js sets when it spawns each sub-agent (see
// runAgent -> spawnClaude in dev-loop.js) and blocks any Edit/Write outside
// that role's allowed paths.
//
// Wired up in .claude/settings.json. Sitting in .claude/hooks/ does not register
// a hook — only the settings.json "hooks" block does. An unlisted script here
// never runs.
//
// Orchestrator runs (no AGENT_ROLE set) and interactive sessions are
// left unrestricted by this hook on purpose.

// ESM: the root package.json sets "type": "module", so .js here is ESM.
import path from 'path'

const ALLOWED_WRITE_PREFIXES = {
  frontend: ['frontend/', '.orchestrate/api-contract.yaml', '.orchestrate/frontend-agent-report.md'],
  backend: ['backend/', '.orchestrate/backend-agent-report.md'],
  // QA writes its report plus tests — it may add coverage but never feature source.
  qa: ['.orchestrate/qa-report.md', 'frontend/tests/', 'frontend/e2e/', 'tests/']
}

let input = ''
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  const role = process.env.AGENT_ROLE
  const allowedPrefixes = role && ALLOWED_WRITE_PREFIXES[role]
  if (!allowedPrefixes) {
    process.exit(0) // no role set (orchestrator / interactive) - not this hook's job
  }

  let payload
  try {
    payload = JSON.parse(input)
  } catch {
    process.exit(0)
  }

  const rawPath = payload?.tool_input?.file_path ?? ''
  if (!rawPath) {
    process.exit(0)
  }

  // Claude Code sends an ABSOLUTE file_path, so comparing it directly against
  // repo-relative prefixes never matches - relativize against the project root
  // first (payload.cwd when present, otherwise this process's cwd).
  const projectRoot = payload?.cwd || process.cwd()
  const filePath = toRepoRelative(rawPath, projectRoot)

  // A write that escapes the repo entirely is out of every role's lane.
  const escapesRepo = filePath.startsWith('../') || path.isAbsolute(filePath)
  const isAllowed = !escapesRepo && allowedPrefixes.some(prefix => filePath.startsWith(prefix))

  if (!isAllowed) {
    console.error(
      `[guardrail] "${role}" agent tried to write outside its allowed paths: "${filePath}". ` +
      `Allowed: ${allowedPrefixes.join(', ')}`
    )
    process.exit(2)
  }

  process.exit(0)
})

function toRepoRelative(rawPath, projectRoot) {
  const normalized = path.isAbsolute(rawPath)
    ? path.relative(projectRoot, rawPath)
    : rawPath
  return normalized.replace(/\\/g, '/').replace(/^\.\//, '')
}
