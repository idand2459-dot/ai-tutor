import Anthropic from '@anthropic-ai/sdk'
import type { MessagesClient, UpstreamStream } from '../../src/lib/chat.service.js'
import type { QuizMessagesClient, QuizRequestOptions } from '../../src/lib/quiz.service.js'

// Event builders. Casts keep fixtures minimal; the service reads only these fields.
export function textDelta(text: string): Anthropic.MessageStreamEvent {
  return { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } as Anthropic.MessageStreamEvent
}

export function stopWith(stopReason: Anthropic.StopReason): Anthropic.MessageStreamEvent {
  return { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null } } as Anthropic.MessageStreamEvent
}

export function otherEvent(
  type: 'message_start' | 'content_block_start' | 'content_block_stop' | 'message_stop'
): Anthropic.MessageStreamEvent {
  return { type } as Anthropic.MessageStreamEvent
}

export type FakeStream = UpstreamStream & { abortCalls: number }

// Replays `events`, then throws `failWith` if given. After abort() it throws
// APIUserAbortError, like the SDK's MessageStream.
export function fakeStream(events: Anthropic.MessageStreamEvent[], failWith?: unknown): FakeStream {
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
      if (failWith !== undefined) {
        throw failWith
      }
    }
  }
  return stream
}

// Yields `events`, then waits until abort() is called and throws APIUserAbortError —
// a reply that never finishes on its own, for disconnect tests.
export function hangingStream(events: Anthropic.MessageStreamEvent[]) {
  let release: () => void = () => {}
  const aborted = new Promise<void>(resolve => {
    release = resolve
  })
  const stream = {
    abortCalls: 0,
    aborted,
    abort() {
      stream.abortCalls++
      release()
    },
    async *[Symbol.asyncIterator]() {
      yield* events
      await aborted
      throw new Anthropic.APIUserAbortError()
    }
  }
  return stream
}

// A non-streaming response with one text block. Casts keep fixtures minimal; the quiz
// service reads only `content` and `stop_reason`.
export function textMessage(text: string, stopReason: Anthropic.StopReason = 'end_turn'): Anthropic.Message {
  return {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: stopReason
  } as Anthropic.Message
}

export function refusalMessage(): Anthropic.Message {
  return { type: 'message', role: 'assistant', content: [], stop_reason: 'refusal' } as unknown as Anthropic.Message
}

export type CreateRequest = {
  params: Anthropic.MessageCreateParamsNonStreaming
  options: QuizRequestOptions | undefined
}

// `stream` serves chat requests. `createResponses` serves quiz requests in order: a Message
// is returned, an Error is thrown. Running out of scripted responses fails the test.
export function fakeClient(
  stream: UpstreamStream = fakeStream([]),
  createResponses: (Anthropic.Message | Error)[] = []
) {
  const requests: Anthropic.MessageStreamParams[] = []
  const createRequests: CreateRequest[] = []
  const client: MessagesClient & QuizMessagesClient = {
    messages: {
      stream(params) {
        requests.push(params)
        return stream
      },
      async create(params, options) {
        createRequests.push({ params, options })
        const response = createResponses[createRequests.length - 1]
        if (response === undefined) {
          throw new Error(`fakeClient: no scripted response for create call ${createRequests.length}`)
        }
        if (response instanceof Error) {
          throw response
        }
        return response
      }
    }
  }
  return { client, requests, createRequests }
}

// SDK errors as the client throws them for an HTTP status. `providerMessage` stands in
// for upstream detail that must never reach the browser.
export function upstreamError(status: number, providerMessage = 'provider-secret-detail') {
  return Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type: 'some_error', message: providerMessage } },
    providerMessage,
    new Headers()
  )
}
