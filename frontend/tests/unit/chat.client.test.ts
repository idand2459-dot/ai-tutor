// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { streamChat } from "@/lib/chat.client"
import { ChatError } from "@/lib/chat-error"
import { PROXY_URL } from "@/lib/config"
import type { ChatEvent, Message } from "@/types/chat"
import { createControlledSseResponse, formatSseEvent } from "./helpers/controlled-sse-response"

const chat: Message[] = [
  { id: "m1", role: "user", content: "why is my loop infinite?" },
  { id: "m2", role: "tutor", content: "What condition ends the loop?" },
  { id: "m3", role: "user", content: "  i < 10  " },
]

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const collected: ChatEvent[] = []
  for await (const event of events) {
    collected.push(event)
  }
  return collected
}

// Resolves fetch with an SSE body that already holds `chunks`, then closes it.
function respondWithChunks(chunks: string[]) {
  const sse = createControlledSseResponse({ headers: { "X-Request-Id": "req-stream" } })
  chunks.forEach((chunk) => sse.push(chunk))
  sse.close()
  fetchMock.mockResolvedValue(sse.response)
}

function errorBody(code: string, requestId: string) {
  return { error: { code, message: "human-readable summary" }, requestId }
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": "req-header" },
  })
}

async function captureError(events: AsyncIterable<ChatEvent>): Promise<ChatError> {
  try {
    await collect(events)
  } catch (error) {
    if (error instanceof ChatError) {
      return error
    }
    throw error
  }
  throw new Error("expected streamChat to throw a ChatError")
}

describe("streamChat request", () => {
  it("posts the chat to the proxy as role and content only", async () => {
    respondWithChunks([formatSseEvent("done", {})])

    await collect(streamChat(chat))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${PROXY_URL}/api/chat`)
    expect(init?.method).toBe("POST")
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json")
    expect(JSON.parse(init?.body as string)).toEqual({
      messages: [
        { role: "user", content: "why is my loop infinite?" },
        { role: "tutor", content: "What condition ends the loop?" },
        { role: "user", content: "  i < 10  " },
      ],
    })
  })

  it("sends no client-only id field", async () => {
    respondWithChunks([formatSseEvent("done", {})])

    await collect(streamChat(chat))

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    for (const message of body.messages) {
      expect(message).not.toHaveProperty("id")
    }
  })
})

describe("streamChat stream", () => {
  it("yields three deltas in order, then done", async () => {
    respondWithChunks([
      formatSseEvent("delta", { text: "What does " }),
      formatSseEvent("delta", { text: "the loop " }),
      formatSseEvent("delta", { text: "condition check?" }),
      formatSseEvent("done", {}),
    ])

    expect(await collect(streamChat(chat))).toEqual([
      { type: "delta", text: "What does " },
      { type: "delta", text: "the loop " },
      { type: "delta", text: "condition check?" },
      { type: "done" },
    ])
  })

  it("parses an event split across two chunks", async () => {
    const event = formatSseEvent("delta", { text: "split" })
    respondWithChunks([event.slice(0, 15), event.slice(15), formatSseEvent("done", {})])

    expect(await collect(streamChat(chat))).toEqual([
      { type: "delta", text: "split" },
      { type: "done" },
    ])
  })

  it("parses a chunk holding two events", async () => {
    respondWithChunks([
      formatSseEvent("delta", { text: "one" }) + formatSseEvent("delta", { text: "two" }),
      formatSseEvent("done", {}),
    ])

    expect(await collect(streamChat(chat))).toEqual([
      { type: "delta", text: "one" },
      { type: "delta", text: "two" },
      { type: "done" },
    ])
  })

  it("parses CRLF line endings", async () => {
    respondWithChunks([
      formatSseEvent("delta", { text: "crlf" }).replace(/\n/g, "\r\n"),
      formatSseEvent("done", {}),
    ])

    expect(await collect(streamChat(chat))).toEqual([
      { type: "delta", text: "crlf" },
      { type: "done" },
    ])
  })

  it("raises tutor_refused when it is the first event", async () => {
    respondWithChunks([formatSseEvent("error", errorBody("tutor_refused", "req-refused"))])

    const error = await captureError(streamChat(chat))

    expect(error.code).toBe("tutor_refused")
    expect(error.requestId).toBe("req-refused")
  })

  it("raises a mid-stream error event after a delta", async () => {
    respondWithChunks([
      formatSseEvent("delta", { text: "partial" }),
      formatSseEvent("error", errorBody("upstream_unavailable", "req-mid")),
    ])
    const events: ChatEvent[] = []

    const error = await captureError(
      (async function* () {
        for await (const event of streamChat(chat)) {
          events.push(event)
          yield event
        }
      })(),
    )

    expect(events).toEqual([{ type: "delta", text: "partial" }])
    expect(error.code).toBe("upstream_unavailable")
    expect(error.requestId).toBe("req-mid")
  })

  it("raises upstream_unavailable when the stream closes without done or error", async () => {
    respondWithChunks([formatSseEvent("delta", { text: "cut off" })])

    const error = await captureError(streamChat(chat))

    expect(error.code).toBe("upstream_unavailable")
  })

  it("raises internal_error for a delta whose data is not valid JSON", async () => {
    respondWithChunks(["event: delta\ndata: not json\n\n"])

    const error = await captureError(streamChat(chat))

    expect(error.code).toBe("internal_error")
  })

  it("raises network_error when the connection breaks mid-stream", async () => {
    const sse = createControlledSseResponse()
    sse.push(formatSseEvent("delta", { text: "partial" }))
    sse.error()
    fetchMock.mockResolvedValue(sse.response)

    const error = await captureError(streamChat(chat))

    expect(error.code).toBe("network_error")
  })
})

describe("streamChat failures before the stream", () => {
  it.each([
    [400, "validation_error"],
    [429, "upstream_rate_limited"],
    [500, "proxy_misconfigured"],
    [500, "internal_error"],
    [502, "upstream_unavailable"],
  ])("maps %i %s to a ChatError with the body's code and requestId", async (status, code) => {
    fetchMock.mockResolvedValue(jsonResponse(status, errorBody(code, `req-${code}`)))

    const error = await captureError(streamChat(chat))

    expect(error).toBeInstanceOf(ChatError)
    expect(error.code).toBe(code)
    expect(error.requestId).toBe(`req-${code}`)
  })

  it("keeps an unknown code as its raw string", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, errorBody("brand_new_code", "req-unknown")))

    const error = await captureError(streamChat(chat))

    expect(error.code).toBe("brand_new_code")
  })

  it("raises internal_error for a non-JSON error body", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>Bad Gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    )

    const error = await captureError(streamChat(chat))

    expect(error.code).toBe("internal_error")
  })

  it("raises internal_error for a 2xx response that is not an event stream", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: "ok" }))

    const error = await captureError(streamChat(chat))

    expect(error.code).toBe("internal_error")
    expect(error.requestId).toBe("req-header")
  })

  it("raises network_error when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))

    const error = await captureError(streamChat(chat))

    expect(error.code).toBe("network_error")
    expect(error.requestId).toBeUndefined()
  })
})

describe("streamChat abort", () => {
  it("ends quietly when aborted before the response arrives", async () => {
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"))
      })
    }))
    const controller = new AbortController()

    const result = collect(streamChat(chat, { signal: controller.signal }))
    controller.abort()

    await expect(result).resolves.toEqual([])
  })

  it("stops reading quietly when aborted mid-stream", async () => {
    const sse = createControlledSseResponse()
    fetchMock.mockResolvedValue(sse.response)
    const controller = new AbortController()
    const events = streamChat(chat, { signal: controller.signal })

    sse.push(formatSseEvent("delta", { text: "first" }))
    expect(await events.next()).toEqual({ done: false, value: { type: "delta", text: "first" } })

    const pending = events.next()
    controller.abort()

    await expect(pending).resolves.toEqual({ done: true, value: undefined })
  })

  it("passes the signal to fetch", async () => {
    respondWithChunks([formatSseEvent("done", {})])
    const controller = new AbortController()

    await collect(streamChat(chat, { signal: controller.signal }))

    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal)
  })
})
