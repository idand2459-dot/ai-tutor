// A fetch Response whose SSE body the test writes by hand, one chunk at a time.
// Nothing reaches the reader until the test calls push(), so streaming tests
// need no timers.

export type ControlledSseResponse = {
  response: Response
  push: (eventText: string) => void
  close: () => void
  error: (reason?: unknown) => void
}

export function createControlledSseResponse(init: ResponseInit = {}): ControlledSseResponse {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>

  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
    },
  })

  const headers = new Headers(init.headers)
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "text/event-stream")
  }

  const response = new Response(body, { status: 200, ...init, headers })

  return {
    response,
    push: (eventText) => controller.enqueue(encoder.encode(eventText)),
    close: () => controller.close(),
    error: (reason = new TypeError("network error")) => controller.error(reason),
  }
}

// Formats one SSE event in the wire format of the proxy contract.
export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
