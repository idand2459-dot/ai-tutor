#!/usr/bin/env node
// PreToolUse guardrail: hard-blocks any tool access to env/secret files,
// regardless of which tool is used to reach them (Read, Edit, Write, Bash,
// Grep, Glob...). permissions.deny only covers the exact tool+pattern listed
// and can't see inside a Bash command string - this hook inspects the target
// of every call, so `cat .env`, `Read(.env)` and `grep -r KEY backend/.env`
// are all caught the same way.
//
// The repo root .env holds LINEAR_API_KEY, which is exactly what the dev-loop
// sub-agents must never read back out or echo into a report.
//
// Runs even when AGENT_PERMISSION_MODE=bypassPermissions (dev-loop.js's
// default for the FE/BE/QA sub-agents) - hooks are a separate enforcement
// layer from the permission system, which is exactly why this demo relies
// on them instead of permissions.deny alone.

// Matches a real env file anywhere in the tree - the repo root `.env` (which
// holds LINEAR_API_KEY), plus any future frontend/.env or
// backend/.env. `.env.example` is deliberately NOT matched: it is committed
// template content agents are allowed to read and write.
const SECRET_FILE_PATTERN = /(^|[\/\\])\.env(\.local|\.development|\.production)?(?![\w.-])/i
const SECRET_IN_COMMAND_PATTERN = /(^|[\s"'=/\\])[\w./\\-]*\.env(\.local|\.development|\.production)?(?![\w.-])/i

// Only fields that NAME a target are inspected. Deliberately not scanning the
// whole tool_input: a Write's `content` can legitimately mention an env file
// (setup docs, .env.example templates, this hook's own source) without
// touching one — scanning content made the hook unable to edit itself.
const PATH_FIELDS = ['file_path', 'path', 'notebook_path']

let input = ''
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  let payload
  try {
    payload = JSON.parse(input)
  } catch {
    process.exit(0)
  }

  const toolInput = payload?.tool_input ?? {}

  const blockedPath = PATH_FIELDS
    .map(field => toolInput[field])
    .find(value => typeof value === 'string' && SECRET_FILE_PATTERN.test(value))

  // A shell command can reach a secret file without ever naming a path field:
  // `cat .env`, `grep -r KEY .env`, `type frontend\.env`.
  const command = typeof toolInput.command === 'string' ? toolInput.command : ''
  const blockedCommand = SECRET_IN_COMMAND_PATTERN.test(command)

  if (blockedPath || blockedCommand) {
    console.error(
      `[guardrail] Blocked ${payload?.tool_name ?? 'tool'} call touching an env/secret file` +
      `${blockedPath ? `: ${blockedPath}` : ''}. Use .env.example instead.`
    )
    process.exit(2)
  }

  process.exit(0)
})
