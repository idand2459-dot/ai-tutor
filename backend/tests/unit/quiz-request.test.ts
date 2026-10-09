import { describe, expect, it } from 'vitest'
import { MAX_CONTENT_LENGTH, MAX_MESSAGES, type ChatMessage } from '../../src/lib/chat-request.js'
import { validateQuizRequest } from '../../src/lib/quiz-request.js'

function message(role: ChatMessage['role'], content = `a ${role} message`): ChatMessage {
  return { role, content }
}

// A valid alternating chat of `count` messages that starts with `user`.
function alternatingChat(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => message(index % 2 === 0 ? 'user' : 'tutor'))
}

function issuesOf(body: unknown) {
  const result = validateQuizRequest(body)
  if (result.success) {
    throw new Error('expected validation to fail')
  }
  return result.issues
}

describe('validateQuizRequest', () => {
  describe('valid requests', () => {
    it('accepts a 2-message chat of one user message and one tutor reply', () => {
      const messages = alternatingChat(2)

      const result = validateQuizRequest({ messages })

      expect(result).toEqual({ success: true, data: { messages } })
    })

    it(`accepts the longest valid chat of ${MAX_MESSAGES} messages`, () => {
      const messages = alternatingChat(MAX_MESSAGES)

      expect(validateQuizRequest({ messages }).success).toBe(true)
    })

    it(`accepts content of exactly ${MAX_CONTENT_LENGTH} characters`, () => {
      const messages = [message('user', 'x'.repeat(MAX_CONTENT_LENGTH)), message('tutor')]

      expect(validateQuizRequest({ messages }).success).toBe(true)
    })
  })

  describe('array rules', () => {
    it('rejects an empty messages array', () => {
      expect(issuesOf({ messages: [] })).toEqual([
        { path: 'messages', message: 'must contain at least one message' }
      ])
    })

    it(`rejects ${MAX_MESSAGES + 1} messages`, () => {
      const messages = alternatingChat(MAX_MESSAGES + 1)

      expect(issuesOf({ messages })).toContainEqual(
        { path: 'messages', message: `must contain at most ${MAX_MESSAGES} messages` }
      )
    })

    it('rejects a body that is not an object', () => {
      expect(issuesOf('hi')).toEqual([{ path: '(body)', message: 'must be a JSON object' }])
    })
  })

  describe('order rules', () => {
    it('rejects a chat that ends with a user message', () => {
      const messages = alternatingChat(3)

      expect(issuesOf({ messages })).toEqual([
        { path: 'messages.2.role', message: 'the last message must be from "tutor"' }
      ])
    })

    it('rejects a chat whose first message is from tutor', () => {
      const messages = [message('tutor'), message('user'), message('tutor')]

      expect(issuesOf({ messages })).toEqual([
        { path: 'messages.0.role', message: 'the first message must be from "user"' }
      ])
    })

    it('rejects roles that do not alternate', () => {
      const messages = [message('user'), message('user'), message('tutor')]

      expect(issuesOf({ messages })).toEqual([
        { path: 'messages.1.role', message: 'roles must alternate between "user" and "tutor"' }
      ])
    })
  })

  describe('message rules', () => {
    it(`rejects content of ${MAX_CONTENT_LENGTH + 1} characters`, () => {
      const messages = [message('user', 'x'.repeat(MAX_CONTENT_LENGTH + 1)), message('tutor')]

      expect(issuesOf({ messages })).toEqual([
        { path: 'messages.0.content', message: `must be at most ${MAX_CONTENT_LENGTH} characters` }
      ])
    })

    it('does not echo the content in the issue message', () => {
      const secretLooking = `${'x'.repeat(MAX_CONTENT_LENGTH)}distinctive-user-text`
      const messages = [message('user', secretLooking), message('tutor')]

      const issues = issuesOf({ messages })

      expect(JSON.stringify(issues)).not.toContain('distinctive-user-text')
    })
  })
})
