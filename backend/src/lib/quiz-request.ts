import { z } from 'zod'
import { messageListSchema, type FieldIssue } from './chat-request.js'

// The same message rules as POST /api/chat, but the chat must end with a full exchange:
// a quiz is built from what the tutor already said, so the last message is from "tutor".
export const quizRequestSchema = z.object({
  messages: messageListSchema('tutor')
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
