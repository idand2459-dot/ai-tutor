import Anthropic from '@anthropic-ai/sdk'
import type { MessagesClient, UpstreamStream } from '../../src/lib/chat.service.js'

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

export function fakeClient(stream: UpstreamStream = fakeStream([])) {
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
