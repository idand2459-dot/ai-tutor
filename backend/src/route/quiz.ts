import { Router } from 'express'
import { TutorRefusedError } from '../lib/chat.service.js'
import { getRequestId, sendError, type ErrorCode } from '../lib/http-error.js'
import { validateQuizRequest } from '../lib/quiz-request.js'
import { QuizMalformedError, type QuizService } from '../lib/quiz.service.js'
import { mapChatError } from './chat.js'

export type QuizLogEntry = {
  level: 'warn' | 'error'
  requestId: string
  operation: 'quiz'
  // The HTTP status the client received.
  status: number
  code: ErrorCode
  // Only on quiz_malformed: how many model calls returned malformed output.
  attempts?: number
  // There is no stream, so every quiz failure happens before the response.
  phase: 'before_response'
  // The error class name. Absent on the warn line for a retry that succeeded.
  upstreamError?: string
}

export type QuizLog = (entry: QuizLogEntry) => void

type MappedError = {
  status: number
  code: ErrorCode
  message: string
}

// Fixed strings: never model output or request content.
const MESSAGES = {
  quiz_malformed: 'The tutor could not build a valid quiz. Try again.',
  tutor_refused: 'The tutor cannot build a quiz from this chat.'
} as const

// Quiz-specific failures first; SDK and unexpected errors map exactly as in /api/chat.
export function mapQuizError(error: unknown): MappedError {
  if (error instanceof QuizMalformedError) {
    return { status: 502, code: 'quiz_malformed', message: MESSAGES.quiz_malformed }
  }
  // /api/chat sends a refusal as an SSE event; here there is no stream, so it gets a real status.
  if (error instanceof TutorRefusedError) {
    return { status: 422, code: 'tutor_refused', message: MESSAGES.tutor_refused }
  }
  return mapChatError(error)
}

// The SDK's error classes leave `name` as "Error", so use the class name instead.
function upstreamErrorName(error: unknown) {
  return error instanceof Error ? error.constructor.name : typeof error
}

const consoleLog: QuizLog = entry => {
  console.error(JSON.stringify(entry))
}

export function createQuizRouter({ quizService, log = consoleLog }: { quizService: QuizService, log?: QuizLog }) {
  const router = Router()

  router.post('/', async (req, res) => {
    const validation = validateQuizRequest(req.body)
    if (!validation.success) {
      sendError(res, 400, 'validation_error', 'The quiz request is invalid.', { issues: validation.issues })
      return
    }

    const requestId = getRequestId(res)
    const controller = new AbortController()
    let clientGone = false

    // Same as /api/chat: `res` closes when the response ends or the client disconnects;
    // only the latter needs an abort.
    res.on('close', () => {
      if (!res.writableEnded) {
        clientGone = true
        controller.abort()
      }
    })

    try {
      const { quiz, attempts } = await quizService.generateQuiz(validation.data.messages, { signal: controller.signal })
      if (clientGone) {
        return
      }
      if (attempts > 1) {
        log({ level: 'warn', requestId, operation: 'quiz', status: 200, code: 'quiz_malformed', attempts, phase: 'before_response' })
      }
      res.status(200).json({ quiz })
    } catch (error) {
      if (clientGone) {
        return
      }
      const mapped = mapQuizError(error)
      log({
        level: mapped.code === 'tutor_refused' || mapped.code === 'upstream_rate_limited' ? 'warn' : 'error',
        requestId,
        operation: 'quiz',
        status: mapped.status,
        code: mapped.code,
        ...(error instanceof QuizMalformedError ? { attempts: error.attempts } : {}),
        phase: 'before_response',
        upstreamError: upstreamErrorName(error)
      })
      sendError(res, mapped.status, mapped.code, mapped.message)
    }
  })

  return router
}
