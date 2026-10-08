import { z } from 'zod'
import { MAX_MESSAGES, messageSchema, type FieldIssue } from './chat-request.js'

// The same message rules as POST /api/chat, but the chat must end with a full exchange:
// a quiz is built from what the tutor already said, so the last message is from "tutor".
export const quizRequestSchema = z.object({
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
      if (messages.at(-1)?.role !== 'tutor') {
        ctx.addIssue({ code: 'custom', path: [messages.length - 1, 'role'], message: 'the last message must be from "tutor"' })
      }
      messages.forEach((message, index) => {
        if (index > 0 && message.role === messages[index - 1]?.role) {
          ctx.addIssue({ code: 'custom', path: [index, 'role'], message: 'roles must alternate between "user" and "tutor"' })
        }
      })
    })
}, { error: 'must be a JSON object' })

export type QuizRequest = z.infer<typeof quizRequestSchema>

export type QuizRequestValidation =
  | { success: true, data: QuizRequest }
  | { success: false, issues: FieldIssue[] }

// Validates an untrusted request body, like validateChatRequest. On failure, `issues` is safe
// to return as `error.details` of a 400 validation_error; each path is dotted.
export function validateQuizRequest(body: unknown): QuizRequestValidation {
  const result = quizRequestSchema.safeParse(body)

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
