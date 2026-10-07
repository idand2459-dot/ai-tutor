#!/usr/bin/env node
// PreToolUse guardrail: git commit/merge/push/tag require explicit user approval.
// The agent must ask the user, who then runs the command themselves.

const BLOCKED_SUBCOMMANDS = new Set(['commit', 'merge', 'push', 'tag'])
// git global options that consume the next token as their value
const OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

function gitSubcommand(segment) {
  const tokens = segment.trim().split(/\s+/)
  if (tokens[0] !== 'git') return null
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (OPTIONS_WITH_VALUE.has(token)) {
      i++
      continue
    }
    if (token.startsWith('-')) continue
    return token
  }
  return null
}

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
  // A command can chain several: `git add . && git commit -m x`
  const segments = command.split(/&&|\|\||;|\||\n/)

  for (const segment of segments) {
    const subcommand = gitSubcommand(segment)
    if (subcommand && BLOCKED_SUBCOMMANDS.has(subcommand)) {
      console.error(
        `[guardrail] "git ${subcommand}" needs explicit user approval. ` +
        'Ask the user to approve it and run it themselves; do not retry.'
      )
      process.exit(2) // exit code 2 = block the tool call
    }
  }

  process.exit(0)
})