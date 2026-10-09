import Anthropic from '@anthropic-ai/sdk'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_CONTENT_LENGTH, MAX_MESSAGES, type ChatMessage } from '../../src/lib/chat-request.js'
import { fakeClient, fakeStream, hangingStream, stopWith, textDelta, upstreamError } from '../helpers/fake-anthropic.js'
import { TEST_REQUEST_ID, createTestApp, parseSse } from '../helpers/test-app.js'

const userMessage: ChatMessage = { role: 'user', content: 'why is my loop infinite?' }
const validBody = { messages: [userMessage] }

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

describe('POST /api/chat', () => {
  describe('streaming', () => {
    it('streams each text piece as a delta event, then one done (AC02)', async () => {
      const { client } = fakeClient(fakeStream([textDelta('What does '), textDelta('the loop '), textDelta('check?'), stopWith('end_turn')]))
      const { app } = createTestApp(client)

      const response = await request(app).post('/api/chat').send(validBody)

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toMatch(/^text\/event-stream/)
      expect(response.headers['cache-control']).toContain('no-cache')
      expect(parseSse(response.text)).toEqual([
        { event: 'delta', data: { text: 'What does ' } },
        { event: 'delta', data: { text: 'the loop ' } },
        { event: 'delta', data: { text: 'check?' } },
        { event: 'done', data: {} }
      ])
    })

    it('sends done with no deltas when the reply is empty', async () => {
      const { client } = fakeClient(fakeStream([stopWith('end_turn')]))
      const { app } = createTestApp(client)

      const response = await request(app).post('/api/chat').send(validBody)

      expect(parseSse(response.text)).toEqual([{ event: 'done', data: {} }])
    })

    it('carries the request id header', async () => {
      const { client } = fakeClient(fakeStream([textDelta('hi')]))
      const { app } = createTestApp(client)

      const response = await request(app).post('/api/chat').send(validBody)

      expect(response.headers['x-request-id']).toBe(TEST_REQUEST_ID)
    })
  })

  describe('validation', () => {
    it.each([
      ['an empty messages array', { messages: [] }],
      ['a role outside the contract', { messages: [{ role: 'assistant', content: 'hi' }] }],
      ['a last message from tutor', { messages: [userMessage, { role: 'tutor', content: 'hint' }] }],
      ['an oversized message', { messages: [{ role: 'user', content: 'x'.repeat(MAX_CONTENT_LENGTH + 1) }] }],
      ['too many messages', { messages: alternatingChat(MAX_MESSAGES + 1) }],
      ['no JSON body', undefined]
    ])('returns 400 validation_error for %s', async (_, body) => {
      const { client, requests } = fakeClient()
      const { app } = createTestApp(client)

      const response = await request(app).post('/api/chat').send(body)

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        error: {
          code: 'validation_error',
          message: expect.any(String),
          details: { issues: expect.arrayContaining([{ path: expect.any(String), message: expect.any(String) }]) }
        },
        requestId: TEST_REQUEST_ID
      })
      expect(requests).toHaveLength(0)
    })

    it('accepts a chat whose tutor message is longer than 8,000 characters', async () => {
      const { client } = fakeClient(fakeStream([textDelta('hint'), stopWith('end_turn')]))
      const { app } = createTestApp(client)
      const messages = [userMessage, { role: 'tutor', content: 'x'.repeat(20000) }, userMessage]

      const response = await request(app).post('/api/chat').send({ messages })

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toMatch(/^text\/event-stream/)
    })
  })

  describe('upstream failure before streaming (AC03)', () => {
    it.each([
      ['a network failure', new Anthropic.APIConnectionError({ message: 'provider-secret-detail' }), 502, 'upstream_unavailable'],
      ['a timeout', new Anthropic.APIConnectionTimeoutError({ message: 'provider-secret-detail' }), 502, 'upstream_unavailable'],
      ['an upstream 500', upstreamError(500), 502, 'upstream_unavailable'],
      ['an upstream 529 overload', upstreamError(529), 502, 'upstream_unavailable'],
      ['a rate limit', upstreamError(429), 429, 'upstream_rate_limited'],
      ['an upstream 400 bad request', upstreamError(400), 500, 'proxy_misconfigured'],
      ['a rejected API key', upstreamError(401), 500, 'proxy_misconfigured'],
      ['a forbidden API key', upstreamError(403), 500, 'proxy_misconfigured'],
      ['a non-SDK error', new Error('provider-secret-detail'), 500, 'internal_error']
    ])('maps %s to %i %s as JSON', async (_, failure, status, code) => {
      const { client } = fakeClient(fakeStream([], failure))
      const { app, logs } = createTestApp(client)

      const response = await request(app).post('/api/chat').send(validBody)

      expect(response.status).toBe(status)
      expect(response.headers['content-type']).toMatch(/^application\/json/)
      expect(response.body).toEqual(errorShape(code))
      expect(response.text).not.toContain('provider-secret-detail')
      expect(logs).toEqual([expect.objectContaining({ requestId: TEST_REQUEST_ID, operation: 'chat', status, code, phase: 'before_stream' })])
    })

    it('logs an upstream 400 as an error, since it needs an operator fix', async () => {
      const { client } = fakeClient(fakeStream([], upstreamError(400)))
      const { app, logs } = createTestApp(client)

      await request(app).post('/api/chat').send(validBody)

      expect(logs).toEqual([expect.objectContaining({ level: 'error', code: 'proxy_misconfigured', upstreamError: 'BadRequestError' })])
    })

    it('maps an upstream 404 (unknown model) to 500 proxy_misconfigured without leaking the provider message', async () => {
      const { client } = fakeClient(fakeStream([], upstreamError(404, 'model: not-a-real-model')))
      const { app, logs } = createTestApp(client)

      const response = await request(app).post('/api/chat').send(validBody)

      expect(response.status).toBe(500)
      expect(response.headers['content-type']).toMatch(/^application\/json/)
      expect(response.body).toEqual(errorShape('proxy_misconfigured'))
      expect(response.text).not.toContain('not-a-real-model')
      expect(logs).toEqual([expect.objectContaining({ level: 'error', code: 'proxy_misconfigured', upstreamError: 'NotFoundError' })])
    })

    it('reports a refusal that arrives first as an SSE error event', async () => {
      const { client } = fakeClient(fakeStream([stopWith('refusal')]))
      const { app } = createTestApp(client)

      const response = await request(app).post('/api/chat').send(validBody)

      expect(response.status).toBe(200)
      expect(parseSse(response.text)).toEqual([{ event: 'error', data: errorShape('tutor_refused') }])
    })
  })

  describe('failure mid-stream', () => {
    it('sends exactly one error event after the deltas, no done, and ends the response', async () => {
      const failure = new Anthropic.APIConnectionError({ message: 'provider-secret-detail' })
      const { client } = fakeClient(fakeStream([textDelta('one'), textDelta('two')], failure))
      const { app, logs } = createTestApp(client)

      const response = await request(app).post('/api/chat').send(validBody)

      expect(response.status).toBe(200)
      expect(parseSse(response.text)).toEqual([
        { event: 'delta', data: { text: 'one' } },
        { event: 'delta', data: { text: 'two' } },
        { event: 'error', data: errorShape('upstream_unavailable') }
      ])
      expect(response.text).not.toContain('provider-secret-detail')
      expect(logs).toEqual([expect.objectContaining({
        status: 200,
        code: 'upstream_unavailable',
        phase: 'mid_stream',
        upstreamError: 'APIConnectionError'
      })])
    })

    it('reports a mid-stream rate limit as upstream_unavailable, the only upstream code allowed in the stream', async () => {
      const { client } = fakeClient(fakeStream([textDelta('one')], upstreamError(429)))
      const { app } = createTestApp(client)

      const response = await request(app).post('/api/chat').send(validBody)

      expect(parseSse(response.text).at(-1)).toEqual({ event: 'error', data: errorShape('upstream_unavailable') })
    })

    it('reports a mid-stream 404 as upstream_unavailable without leaking the provider message', async () => {
      const { client } = fakeClient(fakeStream([textDelta('one')], upstreamError(404, 'model: not-a-real-model')))
      const { app } = createTestApp(client)

      const response = await request(app).post('/api/chat').send(validBody)

      expect(response.status).toBe(200)
      expect(parseSse(response.text)).toEqual([
        { event: 'delta', data: { text: 'one' } },
        { event: 'error', data: errorShape('upstream_unavailable') }
      ])
      expect(response.text).not.toContain('not-a-real-model')
    })

    it('reports a refusal after some text as a tutor_refused error event', async () => {
      const { client } = fakeClient(fakeStream([textDelta('Let me'), stopWith('refusal')]))
      const { app } = createTestApp(client)

      const response = await request(app).post('/api/chat').send(validBody)

      expect(parseSse(response.text)).toEqual([
        { event: 'delta', data: { text: 'Let me' } },
        { event: 'error', data: errorShape('tutor_refused') }
      ])
    })
  })

  describe('logging', () => {
    it('logs nothing for a successful reply', async () => {
      const { client } = fakeClient(fakeStream([textDelta('hi'), stopWith('end_turn')]))
      const { app, logs } = createTestApp(client)

      await request(app).post('/api/chat').send(validBody)

      expect(logs).toEqual([])
    })

    it('logs exactly the structured fields, with no content, headers, or provider message', async () => {
      const { client } = fakeClient(fakeStream([], upstreamError(500)))
      const { app, logs } = createTestApp(client)

      await request(app).post('/api/chat').set('Authorization', 'Bearer header-secret').send(validBody)

      expect(logs).toEqual([{
        level: 'error',
        requestId: TEST_REQUEST_ID,
        operation: 'chat',
        status: 502,
        code: 'upstream_unavailable',
        phase: 'before_stream',
        upstreamError: 'InternalServerError'
      }])
      expect(JSON.stringify(logs)).not.toMatch(/header-secret|provider-secret-detail/)
    })

    it('never logs message content', async () => {
      const { client } = fakeClient(fakeStream([], upstreamError(500)))
      const { app, logs } = createTestApp(client)

      await request(app).post('/api/chat').send(validBody)

      expect(JSON.stringify(logs)).not.toContain(userMessage.content)
    })
  })

  describe('client disconnect', () => {
    let server: http.Server | undefined

    afterEach(async () => {
      await new Promise(resolve => server?.close(resolve))
      server = undefined
    })

    it('aborts the upstream stream when the client disconnects mid-reply', async () => {
      const stream = hangingStream([textDelta('one')])
      const { client } = fakeClient(stream)
      const { app, logs } = createTestApp(client)
      server = app.listen(0, '127.0.0.1')
      await new Promise(resolve => server?.once('listening', resolve))
      const { port } = server.address() as AddressInfo

      // Read the first delta, then drop the connection.
      await new Promise<void>((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/api/chat',
          headers: { 'Content-Type': 'application/json' }
        }, res => {
          res.once('data', () => {
            req.destroy()
            resolve()
          })
        })
        req.on('error', error => {
          if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') {
            reject(error)
          }
        })
        req.end(JSON.stringify(validBody))
      })

      await stream.aborted

      expect(stream.abortCalls).toBe(1)
      expect(logs).toEqual([])
    })
  })
})
