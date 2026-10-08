import { z } from 'zod'

export const MAX_MESSAGES = 50
export const MAX_CONTENT_LENGTH = 8000

export const MESSAGE_ROLES = ['user', 'tutor'] as const

// Messages name the rule, never the received value: content can be long, and it is user input.
const messageSchema = z.object({
  role: z.enum(MESSAGE_ROLES, { error: 'must be "user" or "tutor"' }),
  content: z
    .string({ error: 'must be a string' })
    .max(MAX_CONTENT_LENGTH, { error: `must be at most ${MAX_CONTENT_LENGTH} characters` })
    .refine(content => content.trim() !== '', { error: 'must not be empty' })
})

export const chatRequestSchema = z.object({
  messages: z
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
      if (messages.at(-1)?.role !== 'user') {
        ctx.addIssue({ code: 'custom', path: [messages.length - 1, 'role'], message: 'the last message must be from "user"' })
      }
      messages.forEach((message, index) => {
        if (index > 0 && message.role === messages[index - 1]?.role) {
          ctx.addIssue({ code: 'custom', path: [index, 'role'], message: 'roles must alternate between "user" and "tutor"' })
        }
      })
    })
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
