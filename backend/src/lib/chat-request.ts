import { z } from 'zod'

export const MAX_MESSAGES = 50
// The cap for a `user` message.
export const MAX_CONTENT_LENGTH = 8000
// A `tutor` reply can be up to 4,096 tokens, which can be more than 8,000 characters.
export const MAX_TUTOR_CONTENT_LENGTH = 24000

export const MESSAGE_ROLES = ['user', 'tutor'] as const

function contentLimitFor(role: unknown): number {
  return role === 'tutor' ? MAX_TUTOR_CONTENT_LENGTH : MAX_CONTENT_LENGTH
}

// Messages name the rule, never the received value: content can be long, and it is user input.
export const messageSchema = z
  .object({
    role: z.enum(MESSAGE_ROLES, { error: 'must be "user" or "tutor"' }),
    content: z
      .string({ error: 'must be a string' })
      .refine(content => content.trim() !== '', { error: 'must not be empty' })
  })
  .superRefine((message, ctx) => {
    // The cap depends on the role. An unknown role gets the stricter user cap.
    const limit = contentLimitFor(message.role)
    if (typeof message.content === 'string' && message.content.length > limit) {
      ctx.addIssue({ code: 'custom', path: ['content'], message: `must be at most ${limit} characters` })
    }
  }, {
    // Also run when another field already failed, so a long message is never left unchecked.
    when: payload => typeof payload.value === 'object' && payload.value !== null
  })

// The `messages` array and its order rules, shared by POST /api/chat and POST /api/quiz:
// the first message is from "user", the last from `lastRole`, and roles alternate.
export function messageListSchema(lastRole: 'user' | 'tutor') {
  return z
    .array(messageSchema, { error: 'must be an array' })
    .min(1, { error: 'must contain at least one message' })
    .max(MAX_MESSAGES, { error: `must contain at most ${MAX_MESSAGES} messages` })
    .superRefine((messages, ctx) => {
      // An empty array is already reported by `min`; order rules have nothing to check.
      if (messages.length === 0) {
        return
      }
      if (messages[0]?.role !== 'user') {
        ctx.addIssue({ code: 'custom', path: [0, 'role'], message: 'the first message must be from "user"' })
      }
      if (messages.at(-1)?.role !== lastRole) {
        ctx.addIssue({ code: 'custom', path: [messages.length - 1, 'role'], message: `the last message must be from "${lastRole}"` })
      }
      messages.forEach((message, index) => {
        if (index > 0 && message.role === messages[index - 1]?.role) {
          ctx.addIssue({ code: 'custom', path: [index, 'role'], message: 'roles must alternate between "user" and "tutor"' })
        }
      })
    })
}

export const chatRequestSchema = z.object({
  messages: messageListSchema('user')
}, { error: 'must be a JSON object' })

export type ChatRequest = z.infer<typeof chatRequestSchema>
export type ChatMessage = ChatRequest['messages'][number]

export type FieldIssue = {
  path: string
  message: string
}

export type ChatRequestValidation =
  | { success: true, data: ChatRequest }
  | { success: false, issues: FieldIssue[] }

// Validates an untrusted request body. On failure, `issues` is safe to return as
// `error.details` of a 400 validation_error; each path is dotted, e.g. `messages.2.role`.
export function validateChatRequest(body: unknown): ChatRequestValidation {
  const result = chatRequestSchema.safeParse(body)

  if (result.success) {
    return { success: true, data: result.data }
  }

  return {
    success: false,
    issues: result.error.issues.map(issue => ({
      path: issue.path.length > 0 ? issue.path.join('.') : '(body)',
      message: issue.message
    }))
  }
}
