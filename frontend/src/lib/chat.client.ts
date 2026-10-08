import { EventSourceParserStream, type EventSourceMessage } from "eventsource-parser/stream"
import { ChatError } from "@/lib/chat-error"
import { PROXY_URL } from "@/lib/config"
import type { ChatEvent, Message } from "@/types/chat"

export type StreamChatOptions = {
  signal?: AbortSignal
}

// Sends the whole chat to the proxy and yields the tutor reply as it streams.
// Ends after `done`, throws a ChatError on any failure, and ends quietly, with no
// error, when `signal` aborts. It never retries and never logs message content.
export async function* streamChat(
  messages: readonly Message[],
  { signal }: StreamChatOptions = {},
): AsyncGenerator<ChatEvent, void, undefined> {
  let response: Response
  try {
    response = await fetch(`${PROXY_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Only role and content: the client-only id must not reach the proxy.
      body: JSON.stringify({ messages: messages.map(({ role, content }) => ({ role, content })) }),
      signal,
    })
  } catch {
    if (signal?.aborted) {
      return
    }
    throw new ChatError("network_error")
  }

  const headerRequestId = response.headers.get("X-Request-Id") ?? undefined

  if (!response.ok) {
    const error = await readErrorResponse(response, headerRequestId)
    if (signal?.aborted) {
      return
    }
    throw error
  }

  const contentType = response.headers.get("Content-Type") ?? ""
  if (!response.body || !contentType.includes("text/event-stream")) {
    await response.body?.cancel()
    throw new ChatError("internal_error", headerRequestId)
  }

  const reader = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .getReader()

  // Cancelling the reader settles a pending read, so an abort ends the loop even
  // when the body stream does not error on its own.
  const cancelOnAbort = () => {
    reader.cancel().catch(() => {})
  }
  signal?.addEventListener("abort", cancelOnAbort, { once: true })

  try {
    while (true) {
      if (signal?.aborted) {
        return
      }

      let result: ReadableStreamReadResult<EventSourceMessage>
      try {
        result = await reader.read()
      } catch {
        if (signal?.aborted) {
          return
        }
        throw new ChatError("network_error", headerRequestId)
      }

      if (signal?.aborted) {
        return
      }
      if (result.done) {
        // The contract ends every stream with `done` or `error`.
        throw new ChatError("upstream_unavailable", headerRequestId)
      }

      const event = toChatEvent(result.value, headerRequestId)
      if (!event) {
        continue
      }
      yield event
      if (event.type === "done") {
        return
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancelOnAbort)
    reader.cancel().catch(() => {})
  }
}

// Maps one SSE message to a ChatEvent. Throws for an `error` event or a malformed
// payload, and returns null for an event type the contract does not define.
function toChatEvent(message: EventSourceMessage, headerRequestId?: string): ChatEvent | null {
  switch (message.event) {
    case "delta": {
      const data = parseJson(message.data)
      if (!isRecord(data) || typeof data.text !== "string") {
        throw new ChatError("internal_error", headerRequestId)
      }
      return { type: "delta", text: data.text }
    }
    case "done":
      return { type: "done" }
    case "error":
      throw toChatError(parseJson(message.data), headerRequestId)
    default:
      return null
  }
}

async function readErrorResponse(response: Response, headerRequestId?: string): Promise<ChatError> {
  try {
    return toChatError(await response.json(), headerRequestId)
  } catch {
    return new ChatError("internal_error", headerRequestId)
  }
}

// Reads the standard error shape: { error: { code, message, details? }, requestId }.
function toChatError(body: unknown, headerRequestId?: string): ChatError {
  if (!isRecord(body) || !isRecord(body.error) || typeof body.error.code !== "string") {
    return new ChatError("internal_error", headerRequestId)
  }
  const requestId = typeof body.requestId === "string" ? body.requestId : headerRequestId
  return new ChatError(body.error.code, requestId)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
