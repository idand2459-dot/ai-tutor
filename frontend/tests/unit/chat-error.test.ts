import { afterEach, describe, expect, it, vi } from "vitest"
import { streamChat } from "@/lib/chat.client"
import { ChatError, toastTextFor } from "@/lib/chat-error"

describe("toastTextFor", () => {
  it.each([
    ["validation_error", "Message couldn't be sent. Check its length and try again."],
    ["upstream_rate_limited", "The tutor is busy. Wait a moment, then send again."],
    ["proxy_misconfigured", "The proxy isn't set up correctly. Check the backend API key and model."],
    ["upstream_unavailable", "The tutor is unreachable right now. Send again in a moment."],
    ["tutor_refused", "The tutor declined to answer. Try rephrasing your message."],
    ["internal_error", "The proxy hit an unexpected error. Send again."],
    ["network_error", "Can't reach the proxy. Is the backend running on port 4000?"],
  ])("returns the table text for %s", (code, text) => {
    expect(toastTextFor(code)).toBe(text)
  })

  it("returns the internal_error text for an unknown code", () => {
    expect(toastTextFor("brand_new_code")).toBe("The proxy hit an unexpected error. Send again.")
  })

  it("returns the internal_error text for a name inherited from Object", () => {
    expect(toastTextFor("toString")).toBe("The proxy hit an unexpected error. Send again.")
  })
})

describe("ChatError", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps the code and the requestId", () => {
    const error = new ChatError("tutor_refused", "req-1")

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("ChatError")
    expect(error.code).toBe("tutor_refused")
    expect(error.requestId).toBe("req-1")
    expect(error.message).toBe("Chat request failed: tutor_refused")
  })

  it("carries no user content and not the server's error.message", async () => {
    const userContent = "my secret homework answer"
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({
        error: { code: "validation_error", message: `echo: ${userContent}` },
        requestId: "req-2",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )))

    // A 400 response fails on the first read, before any event.
    const caught = await streamChat([{ id: "m1", role: "user", content: userContent }])
      .next()
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(ChatError)
    const error = caught as ChatError
    expect(error.code).toBe("validation_error")
    expect(error.message).not.toContain(userContent)
    expect(error.message).not.toContain("echo:")
    expect(toastTextFor(error.code)).not.toContain(userContent)
  })
})
