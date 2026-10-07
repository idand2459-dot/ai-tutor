#!/usr/bin/env node
// PreToolUse guardrail: blocks destructive shell patterns before they run.
// Demo purpose: show that a hook enforces a hard boundary even if the
// agent's plan or prompt would have allowed the command, and even when
// the sub-agent was launched with --permission-mode bypassPermissions.

// Access to env/secret FILES is handled by block-secret-file-access.js, which
// runs on every tool. Do not add a bare /\.env\b/ rule here: it also matches
// `process.env`, `import.meta.env` and `$env:`, which blocked ordinary commands.
const DENY_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bgit\s+push\s+--force/i,
  /\bgit\s+reset\s+--hard/i,
  /\bDROP\s+(TABLE|DATABASE)\b/i,
  /\bdelete\s+from\s+\w+\s*;?\s*$/i, // DELETE with no WHERE clause
  /\bsupabase\s+db\s+reset\b/i
]

let input = ''
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  let payload
  try {
    payload = JSON.parse(input)
  } catch {
    process.exit(0)
  }

  const command = payload?.tool_input?.command ?? ''
  const match = DENY_PATTERNS.find(pattern => pattern.test(command))

  if (match) {
    console.error(`[guardrail] Blocked command matching ${match}: ${command}`)
    process.exit(2) // exit code 2 = block the tool call
  }

  process.exit(0)
})
