import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../src/lib/chat-request.js'
import {
  MAX_TOKENS,
  TutorRefusedError,
  createChatService,
  toAnthropicMessages,
  type MessagesClient,
  type UpstreamStream
} from '../../src/lib/chat.service.js'
import { loadConfig } from '../../src/lib/config.js'
import { SYSTEM_PROMPT } from '../../src/lib/system-prompt.js'

const MODEL = 'test-model'

// Event builders. Casts keep fixtures minimal; the service reads only these fields.
function textDelta(text: string): Anthropic.MessageStreamEvent {
  return { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } as Anthropic.MessageStreamEvent
}

function stopWith(stopReason: Anthropic.StopReason): Anthropic.MessageStreamEvent {
  return { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null } } as Anthropic.MessageStreamEvent
}

function otherEvent(type: 'message_start' | 'content_block_start' | 'content_block_stop' | 'message_stop'): Anthropic.MessageStreamEvent {
  return { type } as Anthropic.MessageStreamEvent
}

// A fake upstream that replays `events`, then throws `failWith` if given.
// After abort() it throws APIUserAbortError, like the SDK's MessageStream.
function fakeStream(events: Anthropic.MessageStreamEvent[], failWith?: Error) {
  const stream = {
    abortCalls: 0,
    abort() {
      stream.abortCalls++
    },
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        if (stream.abortCalls > 0) {
          throw new Anthropic.APIUserAbortError()
        }
        yield event
      }
      if (failWith) {
        throw failWith
      }
    }
  }
  return stream
}

function fakeClient(stream: UpstreamStream = fakeStream([])) {
  const requests: Anthropic.MessageStreamParams[] = []
  const client: MessagesClient = {
    messages: {
      stream(params) {
        requests.push(params)
        return stream
      }
    }
  }
  return { client, requests }
}

async function collect(text: AsyncIterable<string>) {
  const pieces: string[] = []
  for await (const piece of text) {
    pieces.push(piece)
  }
  return pieces
}

const userMessage: ChatMessage = { role: 'user', content: 'why is my loop infinite?' }

describe('toAnthropicMessages', () => {
  it('maps tutor to assistant and keeps order and content', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'tutor', content: '  second\n' },
      { role: 'user', content: 'third' }
    ]

    expect(toAnthropicMessages(messages)).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: '  second\n' },
      { role: 'user', content: 'third' }
    ])
  })
})

describe('createChatService', () => {
  describe('request', () => {
    it('sends the system prompt on every request (AC05)', () => {
      const { client, requests } = fakeClient()
      const service = createChatService({ client, model: MODEL })

      service.streamReply([userMessage])
      service.streamReply([userMessage, { role: 'tutor', content: 'hint' }, userMessage])

      expect(requests.map(request => request.system)).toEqual([SYSTEM_PROMPT, SYSTEM_PROMPT])
    })

    it('uses a system prompt that guides instead of solving, unless asked (AC05)', () => {
      expect(SYSTEM_PROMPT).toContain('Guide with questions and hints rather than complete solutions')
      expect(SYSTEM_PROMPT).toContain('unless the user explicitly asks for the full solution')
    })

    it('sends the messages mapped to the Anthropic roles', () => {
      const { client, requests } = fakeClient()

      createChatService({ client, model: MODEL }).streamReply([
        userMessage,
        { role: 'tutor', content: 'hint' },
        userMessage
      ])

      expect(requests[0]?.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user'])
    })

    it('uses claude-haiku-4-5 when ANTHROPIC_MODEL is unset', () => {
      const { client, requests } = fakeClient()
      const { model } = loadConfig({ ANTHROPIC_API_KEY: 'test-key', FRONTEND_URL: 'http://localhost:3000' })

      createChatService({ client, model }).streamReply([userMessage])

      expect(requests[0]?.model).toBe('claude-haiku-4-5')
    })

    it('uses ANTHROPIC_MODEL when it is set', () => {
      const { client, requests } = fakeClient()
      const { model } = loadConfig({
        ANTHROPIC_API_KEY: 'test-key',
        FRONTEND_URL: 'http://localhost:3000',
        ANTHROPIC_MODEL: 'claude-sonnet-5-5'
      })

      createChatService({ client, model }).streamReply([userMessage])

      expect(requests[0]?.model).toBe('claude-sonnet-5-5')
    })

    it('sends only model, max_tokens, system and messages — no thinking or output_config', () => {
      const { client, requests } = fakeClient()

      createChatService({ client, model: MODEL }).streamReply([userMessage])

      expect(Object.keys(requests[0] ?? {}).sort()).toEqual(['max_tokens', 'messages', 'model', 'system'])
      expect(requests[0]?.max_tokens).toBe(MAX_TOKENS)
    })
  })

  describe('reply text', () => {
    it('yields each text delta in order and ignores other events', async () => {
      const stream = fakeStream([
        otherEvent('message_start'),
        otherEvent('content_block_start'),
        textDelta('What does '),
        textDelta('the loop '),
        textDelta('condition check?'),
        otherEvent('content_block_stop'),
        stopWith('end_turn'),
        otherEvent('message_stop')
      ])
      const { client } = fakeClient(stream)

      const reply = createChatService({ client, model: MODEL }).streamReply([userMessage])

      expect(await collect(reply.text)).toEqual(['What does ', 'the loop ', 'condition check?'])
    })

    it('throws TutorRefusedError when the model stops with a refusal', async () => {
      const { client } = fakeClient(fakeStream([textDelta('Partial'), stopWith('refusal')]))
      const reply = createChatService({ client, model: MODEL }).streamReply([userMessage])
      const pieces: string[] = []

      const consume = async () => {
        for await (const piece of reply.text) {
          pieces.push(piece)
        }
      }

      await expect(consume()).rejects.toBeInstanceOf(TutorRefusedError)
      expect(pieces).toEqual(['Partial'])
    })

    it('rethrows an upstream failure unchanged', async () => {
      const failure = new Anthropic.APIConnectionError({ message: 'network down' })
      const { client } = fakeClient(fakeStream([textDelta('Partial')], failure))

      const reply = createChatService({ client, model: MODEL }).streamReply([userMessage])

      await expect(collect(reply.text)).rejects.toBe(failure)
    })
  })

  describe('abort', () => {
    it('aborts the upstream once and ends the text quietly', async () => {
      const stream = fakeStream([textDelta('one'), textDelta('two'), textDelta('three')])
      const { client } = fakeClient(stream)
      const reply = createChatService({ client, model: MODEL }).streamReply([userMessage])
      const pieces: string[] = []

      for await (const piece of reply.text) {
        pieces.push(piece)
        reply.abort()
        reply.abort()
      }

      expect(pieces).toEqual(['one'])
      expect(stream.abortCalls).toBe(1)
    })

    it('still rethrows APIUserAbortError when abort() was not called', async () => {
      const failure = new Anthropic.APIUserAbortError()
      const { client } = fakeClient(fakeStream([], failure))

      const reply = createChatService({ client, model: MODEL }).streamReply([userMessage])

      await expect(collect(reply.text)).rejects.toBe(failure)
    })
  })

  it('accepts the real SDK client as its client', () => {
    // Compile-time check that MessagesClient matches the SDK. Constructing the client sends no request.
    const client: MessagesClient = new Anthropic({ apiKey: 'test-key' })

    expect(client.messages.stream).toBeTypeOf('function')
  })
})
