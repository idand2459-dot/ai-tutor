import Anthropic from '@anthropic-ai/sdk'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_MESSAGES, type ChatMessage } from '../../src/lib/chat-request.js'
import type { MessagesClient } from '../../src/lib/chat.service.js'
import type { QuizMessagesClient } from '../../src/lib/quiz.service.js'
import { fakeClient, fakeStream, refusalMessage, textMessage, upstreamError } from '../helpers/fake-anthropic.js'
import { TEST_REQUEST_ID, createTestApp } from '../helpers/test-app.js'

const chat: ChatMessage[] = [
  { role: 'user', content: 'distinctive-user-content: why is my loop infinite?' },
  { role: 'tutor', content: 'What condition ends the loop?' }
]
const validBody = { messages: chat }

// Marks text that only the model could have written, so tests can prove it never leaks.
const MODEL_MARKER = 'distinctive-model-output'

function question(index: number) {
  return {
    text: `Question ${index}: what ends a loop?`,
    options: ['A false condition', 'A true condition', 'A comment', 'A semicolon'],
    correctOption: 0,
    explanation: 'The loop stops when its condition becomes false.'
  }
}

const validQuiz = { questions: [0, 1, 2, 3, 4].map(question) }
const VALID = () => textMessage(JSON.stringify({ quiz: validQuiz }))
const MALFORMED = () => textMessage(`${MODEL_MARKER}: this is not JSON`)

function alternatingChat(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'tutor',
    content: `message ${index}`
  }))
}

function errorShape(code: string) {
  return {
    error: { code, message: expect.any(String) },
    requestId: TEST_REQUEST_ID
  }
}

function setup(responses: (Anthropic.Message | Error)[]) {
  const { client, createRequests } = fakeClient(undefined, responses)
  const { app, logs } = createTestApp(client)
  return { app, logs, createRequests }
}

describe('POST /api/quiz', () => {
  describe('success', () => {
    it('returns 200 application/json with { quiz: { questions } } and the request id', async () => {
      const { app, logs } = setup([VALID()])

      const response = await request(app).post('/api/quiz').send(validBody)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toMatch(/^application\/json/)
      expect(response.headers['x-request-id']).toBe(TEST_REQUEST_ID)
      expect(response.body).toEqual({ quiz: validQuiz })
      expect(logs).toEqual([])
    })
  })

  describe('validation', () => {
    it.each([
      ['an empty messages array', { messages: [] }],
      ['a last message from user', { messages: [chat[0]] }],
      ['a role outside the contract', { messages: [chat[0], { role: 'assistant', content: 'hint' }] }],
      ['too many messages', { messages: alternatingChat(MAX_MESSAGES + 2) }],
      ['no JSON body', undefined]
    ])('returns 400 validation_error for %s without calling the model', async (_, body) => {
      const { app, createRequests } = setup([])

      const response = await request(app).post('/api/quiz').send(body)

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        error: {
          code: 'validation_error',
          message: expect.any(String),
          details: { issues: expect.arrayContaining([{ path: expect.any(String), message: expect.any(String) }]) }
        },
        requestId: TEST_REQUEST_ID
      })
      expect(createRequests).toHaveLength(0)
    })
  })

  describe('malformed output (AC04)', () => {
    it('returns 502 quiz_malformed after two malformed responses, with no model output in the body', async () => {
      const { app, createRequests } = setup([MALFORMED(), MALFORMED()])

      const response = await request(app).post('/api/quiz').send(validBody)

      expect(response.status).toBe(502)
      expect(response.headers['content-type']).toMatch(/^application\/json/)
      expect(response.body).toEqual(errorShape('quiz_malformed'))
      expect(response.text).not.toContain(MODEL_MARKER)
      expect(createRequests).toHaveLength(2)
    })

    it('returns 200 when the retry succeeds', async () => {
      const { app } = setup([MALFORMED(), VALID()])

      const response = await request(app).post('/api/quiz').send(validBody)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ quiz: validQuiz })
    })
  })

  describe('upstream failures', () => {
    it('maps a refusal to 422 tutor_refused', async () => {
      const { app } = setup([refusalMessage()])

      const response = await request(app).post('/api/quiz').send(validBody)

      expect(response.status).toBe(422)
      expect(response.body).toEqual(errorShape('tutor_refused'))
    })

    it.each([
      ['a rate limit', upstreamError(429), 429, 'upstream_rate_limited'],
      ['a rejected API key', upstreamError(401), 500, 'proxy_misconfigured'],
      ['an upstream 400 bad request', upstreamError(400), 500, 'proxy_misconfigured'],
      ['a network failure', new Anthropic.APIConnectionError({ message: 'provider-secret-detail' }), 502, 'upstream_unavailable'],
      ['a non-SDK error', new Error('provider-secret-detail'), 500, 'internal_error']
    ])('maps %s to %i %s without the provider message', async (_, failure, status, code) => {
      const { app } = setup([failure])

      const response = await request(app).post('/api/quiz').send(validBody)

      expect(response.status).toBe(status)
      expect(response.headers['content-type']).toMatch(/^application\/json/)
      expect(response.body).toEqual(errorShape(code))
      expect(response.text).not.toContain('provider-secret-detail')
    })
  })

  describe('logging', () => {
    it('logs one error line with attempts for quiz_malformed', async () => {
      const { app, logs } = setup([MALFORMED(), MALFORMED()])

      await request(app).post('/api/quiz').send(validBody)

      expect(logs).toEqual([{
        level: 'error',
        requestId: TEST_REQUEST_ID,
        operation: 'quiz',
        status: 502,
        code: 'quiz_malformed',
        attempts: 2,
        phase: 'before_response',
        upstreamError: 'QuizMalformedError'
      }])
    })

    it.each([
      ['a refusal', refusalMessage(), 'warn', 422, 'tutor_refused', 'TutorRefusedError'],
      ['a rate limit', upstreamError(429), 'warn', 429, 'upstream_rate_limited', 'RateLimitError'],
      ['a rejected API key', upstreamError(401), 'error', 500, 'proxy_misconfigured', 'AuthenticationError'],
      ['a network failure', new Anthropic.APIConnectionError({ message: 'x' }), 'error', 502, 'upstream_unavailable', 'APIConnectionError']
    ])('logs one line for %s, with no attempts field', async (_, failure, level, status, code, upstreamErrorName) => {
      const { app, logs } = setup([failure])

      await request(app).post('/api/quiz').send(validBody)

      expect(logs).toEqual([{
        level,
        requestId: TEST_REQUEST_ID,
        operation: 'quiz',
        status,
        code,
        phase: 'before_response',
        upstreamError: upstreamErrorName
      }])
    })

    it('logs one warn line with attempts 2 when the retry succeeds', async () => {
      const { app, logs } = setup([MALFORMED(), VALID()])

      await request(app).post('/api/quiz').send(validBody)

      expect(logs).toEqual([{
        level: 'warn',
        requestId: TEST_REQUEST_ID,
        operation: 'quiz',
        status: 200,
        code: 'quiz_malformed',
        attempts: 2,
        phase: 'before_response'
      }])
    })

    it('never logs message content, model output, or the provider message', async () => {
      // Each failure carries a secret in its own message, so a log line that copied the
      // error message or the model output would fail this test.
      const malformed = setup([MALFORMED(), MALFORMED()])
      const connection = setup([new Anthropic.APIConnectionError({ message: 'provider-secret-detail' })])
      const unexpected = setup([new Error('provider-secret-detail')])

      await request(malformed.app).post('/api/quiz').send(validBody)
      await request(connection.app).post('/api/quiz').send(validBody)
      await request(unexpected.app).post('/api/quiz').send(validBody)

      const logs = [...malformed.logs, ...connection.logs, ...unexpected.logs]
      expect(logs.map(entry => entry.code)).toEqual(['quiz_malformed', 'upstream_unavailable', 'internal_error'])
      const logged = JSON.stringify(logs)
      expect(logged).not.toContain('distinctive-user-content')
      expect(logged).not.toContain(MODEL_MARKER)
      expect(logged).not.toContain('provider-secret-detail')
    })
  })

  describe('client disconnect', () => {
    let server: http.Server | undefined

    afterEach(async () => {
      await new Promise(resolve => server?.close(resolve))
      server = undefined
    })

    it('aborts the signal passed to create and logs nothing', async () => {
      let receivedSignal: AbortSignal | undefined
      let markCalled: () => void = () => {}
      const called = new Promise<void>(resolve => {
        markCalled = resolve
      })
      // A create that never answers on its own and rejects like the SDK once aborted.
      const client: MessagesClient & QuizMessagesClient = {
        messages: {
          stream: () => fakeStream([]),
          create: (_params, options) => new Promise((_resolve, reject) => {
            receivedSignal = options?.signal
            options?.signal?.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError()))
            markCalled()
          })
        }
      }
      const { app, logs } = createTestApp(client)
      server = app.listen(0, '127.0.0.1')
      await new Promise(resolve => server?.once('listening', resolve))
      const { port } = server.address() as AddressInfo

      const req = http.request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/api/quiz',
        headers: { 'Content-Type': 'application/json' }
      })
      req.on('error', () => {})
      req.end(JSON.stringify(validBody))

      await called
      req.destroy()
      await new Promise<void>(resolve => {
        if (receivedSignal?.aborted) {
          resolve()
        } else {
          receivedSignal?.addEventListener('abort', () => resolve())
        }
      })
      // Let the route's catch run before checking the logs.
      await new Promise(resolve => setImmediate(resolve))

      expect(receivedSignal?.aborted).toBe(true)
      expect(logs).toEqual([])
    })
  })
})
