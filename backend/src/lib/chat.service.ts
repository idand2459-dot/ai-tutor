import Anthropic from '@anthropic-ai/sdk'
import type { ChatMessage } from './chat-request.js'
import { SYSTEM_PROMPT } from './system-prompt.js'

export const MAX_TOKENS = 4096

// The slice of the SDK's MessageStream the service uses. The real client satisfies it,
// and tests pass a fake that needs no network.
export type UpstreamStream = AsyncIterable<Anthropic.MessageStreamEvent> & {
  abort(): void
}

export type MessagesClient = {
  messages: {
    stream(params: Anthropic.MessageStreamParams): UpstreamStream
  }
}

export type ChatReply = {
  // Yields the tutor reply text in order. Throws the SDK's error if the upstream fails,
  // or TutorRefusedError if the model declines. Ends quietly after abort().
  text: AsyncIterable<string>
  // Stops the upstream request so it stops spending tokens. Safe to call more than once.
  abort(): void
}

export class TutorRefusedError extends Error {
  override name = 'TutorRefusedError'
}

export function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map(message => ({
    role: message.role === 'tutor' ? 'assistant' : 'user',
    content: message.content
  }))
}

export function createChatService({ client, model }: { client: MessagesClient, model: string }) {
  return {
    streamReply(messages: ChatMessage[]): ChatReply {
      // No `thinking` and no `output_config`: the default model rejects `effort` (plan 001, Q2).
      const upstream = client.messages.stream({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: toAnthropicMessages(messages)
      })
      let aborted = false

      async function* text() {
        try {
          for await (const event of upstream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              yield event.delta.text
            } else if (event.type === 'message_delta' && event.delta.stop_reason === 'refusal') {
              throw new TutorRefusedError('The model declined to answer')
            }
          }
        } catch (error) {
          if (aborted && error instanceof Anthropic.APIUserAbortError) {
            return
          }
          throw error
        }
      }

      return {
        text: text(),
        abort() {
          if (!aborted) {
            aborted = true
            upstream.abort()
          }
        }
      }
    }
  }
}

export type ChatService = ReturnType<typeof createChatService>
