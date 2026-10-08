import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { fakeClient, fakeStream, textDelta, textMessage } from '../helpers/fake-anthropic.js'

const FRONTEND_URL = 'http://localhost:3000'
const OTHER_ORIGIN = 'http://evil.example'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const quizChat = [{ role: 'user', content: 'hi' }, { role: 'tutor', content: 'hello' }]
const quizOutput = {
  quiz: {
    questions: [0, 1, 2, 3, 4].map(index => ({
      text: `Question ${index}?`,
      options: ['A', 'B', 'C', 'D'],
      correctOption: 0,
      explanation: 'A is right.'
    }))
  }
}

function buildApp() {
  const { client, requests } = fakeClient(fakeStream([textDelta('hi')]), [textMessage(JSON.stringify(quizOutput))])
  const app = createApp({
    client,
    config: { frontendUrl: FRONTEND_URL, model: 'test-model' },
    log: () => {}
  })
  return { app, requests }
}

describe('app', () => {
  describe('GET /api/health', () => {
    it('returns 200 { status: "ok" }', async () => {
      const response = await request(buildApp().app).get('/api/health')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ status: 'ok' })
    })
  })

  describe('request id', () => {
    it('sets a UUID X-Request-Id header on every response', async () => {
      const { app } = buildApp()

      const health = await request(app).get('/api/health')
      const missing = await request(app).get('/api/nope')

      expect(health.headers['x-request-id']).toMatch(UUID)
      expect(missing.headers['x-request-id']).toMatch(UUID)
    })

    it('uses a new id per request', async () => {
      const { app } = buildApp()

      const first = await request(app).get('/api/health')
      const second = await request(app).get('/api/health')

      expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id'])
    })

    it('repeats the header id as requestId in error bodies', async () => {
      const response = await request(buildApp().app).get('/api/nope')

      expect(response.body.requestId).toBe(response.headers['x-request-id'])
    })
  })

  describe('unknown routes', () => {
    it.each([
      ['GET', '/api/nope'],
      ['GET', '/'],
      ['POST', '/api/health'],
      ['GET', '/api/chat']
    ])('returns 404 not_found in the error shape for %s %s', async (method, path) => {
      const app = buildApp().app

      const response = method === 'GET' ? await request(app).get(path) : await request(app).post(path)

      expect(response.status).toBe(404)
      expect(response.body).toEqual({
        error: { code: 'not_found', message: expect.any(String) },
        requestId: expect.stringMatching(UUID)
      })
    })
  })

  describe('request body', () => {
    it('returns 400 validation_error for malformed JSON without calling the model', async () => {
      const { app, requests } = buildApp()

      const response = await request(app)
        .post('/api/chat')
        .set('Content-Type', 'application/json')
        .send('{"messages": [')

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        error: { code: 'validation_error', message: expect.any(String), details: { reason: 'malformed_json' } },
        requestId: expect.stringMatching(UUID)
      })
      expect(requests).toHaveLength(0)
    })

    it('returns 400 validation_error for a body over the size limit', async () => {
      const { app, requests } = buildApp()
      const huge = JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(3 * 1024 * 1024) }] })

      const response = await request(app)
        .post('/api/chat')
        .set('Content-Type', 'application/json')
        .send(huge)

      expect(response.status).toBe(400)
      expect(response.body.error).toEqual({
        code: 'validation_error',
        message: expect.any(String),
        details: { reason: 'body_too_large' }
      })
      expect(requests).toHaveLength(0)
    })
  })

  describe('CORS', () => {
    it('allows FRONTEND_URL and exposes the request id header', async () => {
      const response = await request(buildApp().app).get('/api/health').set('Origin', FRONTEND_URL)

      expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_URL)
      expect(response.headers['access-control-expose-headers']).toContain('X-Request-Id')
    })

    it('sends no allow header to another origin', async () => {
      const response = await request(buildApp().app).get('/api/health').set('Origin', OTHER_ORIGIN)

      expect(response.headers['access-control-allow-origin']).toBeUndefined()
    })

    it('answers a preflight from FRONTEND_URL for POST /api/chat', async () => {
      const response = await request(buildApp().app)
        .options('/api/chat')
        .set('Origin', FRONTEND_URL)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type')

      expect(response.status).toBe(204)
      expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_URL)
      expect(response.headers['access-control-allow-methods']).toContain('POST')
      expect(response.headers['access-control-allow-headers']).toContain('Content-Type')
    })

    it('gives a preflight from another origin no allow header', async () => {
      const response = await request(buildApp().app)
        .options('/api/chat')
        .set('Origin', OTHER_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')

      expect(response.headers['access-control-allow-origin']).toBeUndefined()
    })
  })

  describe('chat route', () => {
    it('is mounted at POST /api/chat', async () => {
      const response = await request(buildApp().app)
        .post('/api/chat')
        .send({ messages: [{ role: 'user', content: 'hi' }] })

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toMatch(/^text\/event-stream/)
    })
  })

  describe('quiz route', () => {
    it('is mounted at POST /api/quiz', async () => {
      const response = await request(buildApp().app).post('/api/quiz').send({ messages: quizChat })

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toMatch(/^application\/json/)
      expect(response.body.quiz.questions).toHaveLength(5)
    })

    it('returns 404 not_found for GET /api/quiz', async () => {
      const response = await request(buildApp().app).get('/api/quiz')

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('not_found')
    })

    it('allows FRONTEND_URL on POST /api/quiz', async () => {
      const response = await request(buildApp().app)
        .post('/api/quiz')
        .set('Origin', FRONTEND_URL)
        .send({ messages: quizChat })

      expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_URL)
    })

    it('sends no allow header to another origin on POST /api/quiz', async () => {
      const response = await request(buildApp().app)
        .post('/api/quiz')
        .set('Origin', OTHER_ORIGIN)
        .send({ messages: quizChat })

      expect(response.headers['access-control-allow-origin']).toBeUndefined()
    })

    it('answers a preflight from FRONTEND_URL for POST /api/quiz', async () => {
      const response = await request(buildApp().app)
        .options('/api/quiz')
        .set('Origin', FRONTEND_URL)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type')

      expect(response.status).toBe(204)
      expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_URL)
      expect(response.headers['access-control-allow-methods']).toContain('POST')
    })

    it('gives a preflight from another origin no allow header for POST /api/quiz', async () => {
      const response = await request(buildApp().app)
        .options('/api/quiz')
        .set('Origin', OTHER_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')

      expect(response.headers['access-control-allow-origin']).toBeUndefined()
    })
  })
})
