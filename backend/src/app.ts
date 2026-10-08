import { randomUUID } from 'node:crypto'
import cors from 'cors'
import express, { type ErrorRequestHandler } from 'express'
import { createChatService, type MessagesClient } from './lib/chat.service.js'
import type { Config } from './lib/config.js'
import { getRequestId, sendError } from './lib/http-error.js'
import { createChatRouter, type ChatLog } from './route/chat.js'

// Large enough for the biggest valid chat (50 messages × 8,000 characters, at up to
// 4 UTF-8 bytes each) plus JSON overhead. Validation enforces the real limits.
export const BODY_LIMIT = '2mb'

// body-parser error types that mean the client sent a body we can't read. Each maps to
// 400 validation_error, per the API Contract.
const BODY_ERROR_REASONS: Record<string, string> = {
  'entity.parse.failed': 'malformed_json',
  'entity.too.large': 'body_too_large',
  'charset.unsupported': 'unreadable_body',
  'encoding.unsupported': 'unreadable_body',
  'request.size.invalid': 'unreadable_body'
}

function bodyErrorReason(error: unknown) {
  const type = (error as { type?: unknown } | null)?.type
  return typeof type === 'string' ? BODY_ERROR_REASONS[type] : undefined
}

export type AppOptions = {
  client: MessagesClient
  // Only what the app needs. The API key stays with whoever builds `client`.
  config: Pick<Config, 'frontendUrl' | 'model'>
  log?: ChatLog
}

export function createApp({ client, config, log }: AppOptions) {
  const app = express()
  app.disable('x-powered-by')

  app.use((_req, res, next) => {
    const requestId = randomUUID()
    res.locals.requestId = requestId
    res.set('X-Request-Id', requestId)
    next()
  })

  // A function origin, not a string: with a string, cors sends the allow header to every
  // origin. Here a disallowed origin gets no CORS headers at all.
  app.use(cors({
    origin: (origin, callback) => callback(null, origin === config.frontendUrl),
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['X-Request-Id']
  }))

  app.use(express.json({ limit: BODY_LIMIT }))

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.use('/api/chat', createChatRouter({
    chatService: createChatService({ client, model: config.model }),
    ...(log === undefined ? {} : { log })
  }))

  app.use((_req, res) => {
    sendError(res, 404, 'not_found', 'This route does not exist.')
  })

  const handleError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error)
      return
    }

    const reason = bodyErrorReason(error)
    if (reason !== undefined) {
      sendError(res, 400, 'validation_error', 'The request body could not be read as JSON.', { reason })
      return
    }

    console.error(JSON.stringify({
      level: 'error',
      requestId: getRequestId(res),
      operation: 'http',
      code: 'internal_error',
      errorType: error instanceof Error ? error.constructor.name : typeof error
    }))
    sendError(res, 500, 'internal_error', 'Something went wrong in the tutor service. Try again.')
  }
  app.use(handleError)

  return app
}
