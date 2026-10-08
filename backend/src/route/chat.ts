import Anthropic from '@anthropic-ai/sdk'
import { Router, type Response } from 'express'
import { validateChatRequest } from '../lib/chat-request.js'
import { TutorRefusedError, type ChatService } from '../lib/chat.service.js'
import { errorBody, getRequestId, sendError, type ErrorCode } from '../lib/http-error.js'

export type ChatLogEntry = {
  level: 'warn' | 'error'
  requestId: string
  operation: 'chat'
  // The HTTP status the client received: 200 once the stream has started.
  status: number
  code: ErrorCode
  phase: 'before_stream' | 'mid_stream'
  upstreamError: string
}

export type ChatLog = (entry: ChatLogEntry) => void

type MappedError = {
  status: number
  code: ErrorCode
  message: string
}

const MESSAGES = {
  upstream_rate_limited: 'The tutor is getting too many requests. Try again in a moment.',
  proxy_misconfigured: 'The tutor service is not configured correctly.',
  upstream_unavailable: 'The tutor is unavailable right now. Try again.',
  tutor_refused: 'The tutor cannot help with this request. Try rephrasing it.',
  internal_error: 'Something went wrong in the tutor service. Try again.'
} as const

// Most specific first. In the TypeScript SDK, APIConnectionError is a subclass of APIError.
// Never copies the provider message or payload into the result.
export function mapChatError(error: unknown): MappedError {
  if (error instanceof TutorRefusedError) {
    return { status: 200, code: 'tutor_refused', message: MESSAGES.tutor_refused }
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { status: 429, code: 'upstream_rate_limited', message: MESSAGES.upstream_rate_limited }
  }
  // A 400 or 404 from Anthropic means the proxy built a request its setup can't serve (e.g. a bad
  // ANTHROPIC_MODEL); the user's input was already validated, so retrying will not help.
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.NotFoundError
  ) {
    return { status: 500, code: 'proxy_misconfigured', message: MESSAGES.proxy_misconfigured }
  }
  if (error instanceof Anthropic.APIConnectionError || error instanceof Anthropic.APIError) {
    return { status: 502, code: 'upstream_unavailable', message: MESSAGES.upstream_unavailable }
  }
  return { status: 500, code: 'internal_error', message: MESSAGES.internal_error }
}

// After headers are sent the contract allows only these codes in an SSE `error` event.
function toStreamError(mapped: MappedError): MappedError {
  if (mapped.code === 'tutor_refused' || mapped.code === 'internal_error') {
    return mapped
  }
  return { ...mapped, code: 'upstream_unavailable', message: MESSAGES.upstream_unavailable }
}

// The SDK's error classes leave `name` as "Error", so use the class name instead.
function upstreamErrorName(error: unknown) {
  return error instanceof Error ? error.constructor.name : typeof error
}

const consoleLog: ChatLog = entry => {
  console.error(JSON.stringify(entry))
}

function writeEvent(res: Response, event: 'delta' | 'done' | 'error', data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function startStream(res: Response) {
  res.status(200)
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.flushHeaders()
}

export function createChatRouter({ chatService, log = consoleLog }: { chatService: ChatService, log?: ChatLog }) {
  const router = Router()

  router.post('/', async (req, res) => {
    const validation = validateChatRequest(req.body)
    if (!validation.success) {
      sendError(res, 400, 'validation_error', 'The chat request is invalid.', { issues: validation.issues })
      return
    }

    const requestId = getRequestId(res)
    const reply = chatService.streamReply(validation.data.messages)
    let clientGone = false

    // `res` closes when the response ends or the client disconnects; only the latter needs an abort.
    res.on('close', () => {
      if (!res.writableEnded) {
        clientGone = true
        reply.abort()
      }
    })

    const logFailure = (error: unknown, status: number, code: ErrorCode, phase: ChatLogEntry['phase']) => {
      log({
        level: code === 'tutor_refused' || code === 'upstream_rate_limited' ? 'warn' : 'error',
        requestId,
        operation: 'chat',
        status,
        code,
        phase,
        upstreamError: upstreamErrorName(error)
      })
    }

    const text = reply.text[Symbol.asyncIterator]()

    // Wait for the first piece before sending headers, so a connect-time failure
    // still gets a real HTTP status and a JSON error body.
    let first: IteratorResult<string>
    try {
      first = await text.next()
    } catch (error) {
      if (clientGone) {
        return
      }
      const mapped = mapChatError(error)
      logFailure(error, mapped.status, mapped.code, 'before_stream')
      if (mapped.code !== 'tutor_refused') {
        sendError(res, mapped.status, mapped.code, mapped.message)
        return
      }
      // A refusal is part of the stream contract, even when it arrives first.
      startStream(res)
      writeEvent(res, 'error', errorBody(res, mapped.code, mapped.message))
      res.end()
      return
    }

    if (clientGone) {
      return
    }

    startStream(res)

    try {
      let current = first
      while (!current.done) {
        writeEvent(res, 'delta', { text: current.value })
        current = await text.next()
      }
      if (!clientGone) {
        writeEvent(res, 'done', {})
      }
    } catch (error) {
      if (!clientGone) {
        const mapped = toStreamError(mapChatError(error))
        logFailure(error, 200, mapped.code, 'mid_stream')
        writeEvent(res, 'error', errorBody(res, mapped.code, mapped.message))
      }
    }

    res.end()
  })

  return router
}
