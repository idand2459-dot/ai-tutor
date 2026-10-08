import { describe, expect, it } from "vitest"

describe("jsdom test environment", () => {
  it("provides the web stream APIs the chat client needs", () => {
    expect(typeof Response).toBe("function")
    expect(typeof ReadableStream).toBe("function")
    expect(typeof TextDecoderStream).toBe("function")
  })

  it("runs with a DOM", () => {
    expect(typeof document).toBe("object")
  })
})
