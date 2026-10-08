import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MAX_CONTENT_LENGTH,
  MAX_MESSAGES,
  validateChatRequest,
  type ChatMessage
} from '../../src/lib/chat-request.js'

function message(role: ChatMessage['role'], content = `a ${role} message`): ChatMessage {
  return { role, content }
}

// A valid alternating chat of `count` messages that starts with `user`.
function alternatingChat(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => message(index % 2 === 0 ? 'user' : 'tutor'))
}

function issuesOf(body: unknown) {
  const result = validateChatRequest(body)
  if (result.success) {
    throw new Error('expected validation to fail')
  }
  return result.issues
}

describe('validateChatRequest', () => {
  describe('valid requests', () => {
    it('accepts a single user message', () => {
      const result = validateChatRequest({ messages: [message('user')] })

      expect(result).toEqual({ success: true, data: { messages: [message('user')] } })
    })

    it('accepts an alternating chat that starts and ends with user', () => {
      const messages = alternatingChat(5)

      const result = validateChatRequest({ messages })

      expect(result).toEqual({ success: true, data: { messages } })
    })

    it('keeps content exactly as sent, including surrounding whitespace', () => {
      const messages = [message('user', '  const x = 1\n')]

      const result = validateChatRequest({ messages })

      expect(result.success && result.data.messages[0]?.content).toBe('  const x = 1\n')
    })

    it(`accepts content of exactly ${MAX_CONTENT_LENGTH} characters`, () => {
      const result = validateChatRequest({ messages: [message('user', 'x'.repeat(MAX_CONTENT_LENGTH))] })

      expect(result.success).toBe(true)
    })

    it('accepts the longest valid chat under the message limit', () => {
      // The limit is even, so the longest chat ending with user is one shorter.
      const result = validateChatRequest({ messages: alternatingChat(MAX_MESSAGES - 1) })

      expect(result.success).toBe(true)
    })

    it.each([
      ['smoke-chat.json'],
      ['smoke-hint.json']
    ])('accepts the manual smoke-test fixture %s', fileName => {
      // Bodies that the manual curl.exe smoke tests send. Keeps them in sync with the contract.
      const fixture: unknown = JSON.parse(readFileSync(new URL(`../fixtures/${fileName}`, import.meta.url), 'utf8'))

      expect(validateChatRequest(fixture).success).toBe(true)
    })
  })

  describe('body shape', () => {
    it.each([
      ['null', null],
      ['a string', 'hello'],
      ['an array', [message('user')]]
    ])('rejects a body that is %s', (_, body) => {
      expect(issuesOf(body)).toEqual([{ path: '(body)', message: 'must be a JSON object' }])
    })

    it('rejects a body without messages', () => {
      expect(issuesOf({})).toEqual([{ path: 'messages', message: 'must be an array' }])
    })

    it('rejects messages that is not an array', () => {
      expect(issuesOf({ messages: 'hi' })).toEqual([{ path: 'messages', message: 'must be an array' }])
    })
  })

  describe('message count', () => {
    it('rejects an empty messages array', () => {
      expect(issuesOf({ messages: [] })).toEqual([
        { path: 'messages', message: 'must contain at least one message' }
      ])
    })

    it(`rejects more than ${MAX_MESSAGES} messages`, () => {
      expect(issuesOf({ messages: alternatingChat(MAX_MESSAGES + 1) })).toEqual([
        { path: 'messages', message: `must contain at most ${MAX_MESSAGES} messages` }
      ])
    })
  })

  describe('role', () => {
    it('rejects a role outside the contract', () => {
      const messages = [message('user'), { role: 'assistant', content: 'hi' }, message('user')]

      expect(issuesOf({ messages })).toEqual([{ path: 'messages.1.role', message: 'must be "user" or "tutor"' }])
    })
  })

  describe('content', () => {
    it('rejects content that is not a string', () => {
      expect(issuesOf({ messages: [{ role: 'user', content: 42 }] })).toEqual([
        { path: 'messages.0.content', message: 'must be a string' }
      ])
    })

    it.each([
      ['empty', ''],
      ['whitespace only', ' \n\t ']
    ])('rejects content that is %s', (_, content) => {
      expect(issuesOf({ messages: [message('user', content)] })).toEqual([
        { path: 'messages.0.content', message: 'must not be empty' }
      ])
    })

    it(`rejects content longer than ${MAX_CONTENT_LENGTH} characters`, () => {
      const content = 'x'.repeat(MAX_CONTENT_LENGTH + 1)

      expect(issuesOf({ messages: [message('user', content)] })).toEqual([
        { path: 'messages.0.content', message: `must be at most ${MAX_CONTENT_LENGTH} characters` }
      ])
    })

    it('does not echo the content in the issue message', () => {
      const content = `secret-looking ${'x'.repeat(MAX_CONTENT_LENGTH)}`

      const [issue] = issuesOf({ messages: [message('user', content)] })

      expect(issue?.message).not.toContain('secret-looking')
    })
  })

  describe('role order', () => {
    it('rejects a chat whose first message is from tutor', () => {
      const messages = [message('tutor'), message('user')]

      expect(issuesOf({ messages })).toEqual([
        { path: 'messages.0.role', message: 'the first message must be from "user"' }
      ])
    })

    it('rejects a chat whose last message is from tutor', () => {
      const messages = [message('user'), message('tutor')]

      expect(issuesOf({ messages })).toEqual([
        { path: 'messages.1.role', message: 'the last message must be from "user"' }
      ])
    })

    it('rejects two consecutive messages with the same role', () => {
      const messages = [message('user'), message('user')]

      expect(issuesOf({ messages })).toEqual([
        { path: 'messages.1.role', message: 'roles must alternate between "user" and "tutor"' }
      ])
    })
  })
})
