import { describe, expect, it } from "vitest"
import { createControlledSseResponse, formatSseEvent } from "./helpers/controlled-sse-response"

describe("createControlledSseResponse", () => {
  it("delivers pushed chunks in order, then ends on close", async () => {
    const sse = createControlledSseResponse()
    const reader = sse.response.body!.pipeThrough(new TextDecoderStream()).getReader()

    const first = formatSseEvent("delta", { text: "Hello" })
    const second = formatSseEvent("delta", { text: " world" })

    sse.push(first)
    expect(await reader.read()).toEqual({ done: false, value: first })

    sse.push(second)
    expect(await reader.read()).toEqual({ done: false, value: second })

    sse.close()
    expect(await reader.read()).toEqual({ done: true, value: undefined })
  })

  it("defaults to a 200 text/event-stream response", () => {
    const { response } = createControlledSseResponse()

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/event-stream")
  })

  it("fails the reader when the test calls error()", async () => {
    const sse = createControlledSseResponse()
    const reader = sse.response.body!.getReader()

    sse.error()

    await expect(reader.read()).rejects.toThrow("network error")
  })
})
