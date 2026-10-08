import express from 'express'
import { createChatService, type MessagesClient } from '../../src/lib/chat.service.js'
import { createChatRouter, type ChatLogEntry } from '../../src/route/chat.js'

export const TEST_REQUEST_ID = 'test-request-id'

// A minimal app for route tests only — not the real app.ts. It provides just what the
// chat route expects from the app: a request id in res.locals and a parsed JSON body.
export function createTestApp(client: MessagesClient) {
  const logs: ChatLogEntry[] = []
  const app = express()

  app.use((_req, res, next) => {
    res.locals.requestId = TEST_REQUEST_ID
    res.set('X-Request-Id', TEST_REQUEST_ID)
    next()
  })
  app.use(express.json())
  app.use('/api/chat', createChatRouter({
    chatService: createChatService({ client, model: 'test-model' }),
    log: entry => logs.push(entry)
  }))

  return { app, logs }
}

export type SseEvent = {
  event: string
  data: unknown
}

export function parseSse(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .filter(block => block.trim() !== '')
    .map(block => {
      const lines = block.split('\n')
      const event = lines.find(line => line.startsWith('event: '))?.slice('event: '.length) ?? ''
      const data = lines.find(line => line.startsWith('data: '))?.slice('data: '.length) ?? 'null'
      return { event, data: JSON.parse(data) as unknown }
    })
}
