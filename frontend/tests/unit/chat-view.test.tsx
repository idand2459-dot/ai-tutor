import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Toaster, toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatView } from "@/components/chat/chat-view"
import { PROXY_URL } from "@/lib/config"
import { createControlledSseResponse, formatSseEvent } from "./helpers/controlled-sse-response"

const fetchMock = vi.fn<typeof fetch>()

const TOAST = {
  network: "Can't reach the proxy. Is the backend running on port 4000?",
  upstream: "The tutor is unreachable right now. Send again in a moment.",
  refused: "The tutor declined to answer. Try rephrasing your message.",
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  toast.dismiss()
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

function renderChat() {
  const user = userEvent.setup()
  const view = render(
    <>
      <ChatView />
      <Toaster />
    </>,
  )
  const textarea = () => screen.getByRole("textbox", { name: "Message" })
  const sendButton = () => screen.getByRole("button", { name: "Send message" })
  const tutorMessages = () => Array.from(view.container.querySelectorAll("[data-role='tutor']"))
  const userMessages = () => Array.from(view.container.querySelectorAll("[data-role='user']"))
  const lastTutorText = () => tutorMessages().at(-1)?.textContent?.trim()
  const indicator = () => screen.queryByRole("status", { name: "The tutor is thinking" })

  async function typeAndSend(text: string) {
    await user.type(textarea(), text)
    await user.click(sendButton())
  }

  return { user, textarea, sendButton, tutorMessages, userMessages, lastTutorText, indicator, typeAndSend }
}

// Queues a controlled SSE response for the next fetch call.
function nextStream() {
  const sse = createControlledSseResponse({ headers: { "X-Request-Id": "req-stream" } })
  fetchMock.mockResolvedValueOnce(sse.response)
  return {
    delta: (text: string) => act(async () => sse.push(formatSseEvent("delta", { text }))),
    done: () => act(async () => {
      sse.push(formatSseEvent("done", {}))
      sse.close()
    }),
    error: (code: string) => act(async () => {
      sse.push(formatSseEvent("error", { error: { code, message: "summary" }, requestId: `req-${code}` }))
      sse.close()
    }),
  }
}

// Completes one exchange so the chat has history.
async function completeExchange(chat: ReturnType<typeof renderChat>, question: string, reply: string) {
  const stream = nextStream()
  await chat.typeAndSend(question)
  await stream.delta(reply)
  await stream.done()
  await waitFor(() => expect(screen.getByRole("log", { name: "Chat" })).toHaveAttribute("aria-busy", "false"))
}

function requestBody(callIndex: number) {
  return JSON.parse(fetchMock.mock.calls[callIndex][1]?.body as string)
}

describe("ChatView streaming (AC02)", () => {
  it("shows the loading indicator, then each chunk as it arrives, then re-enables send", async () => {
    const chat = renderChat()
    const stream = nextStream()

    await chat.typeAndSend("why is my loop infinite?")

    expect(chat.indicator()).toBeInTheDocument()
    expect(chat.sendButton()).toBeDisabled()

    await stream.delta("What does")
    await waitFor(() => expect(chat.lastTutorText()).toBe("What does"))

    await stream.delta(" the loop condition check?")
    await waitFor(() => expect(chat.lastTutorText()).toBe("What does the loop condition check?"))

    await stream.done()
    await waitFor(() => expect(chat.indicator()).not.toBeInTheDocument())
    await chat.user.type(chat.textarea(), "next question")
    expect(chat.sendButton()).toBeEnabled()
  })

  it("keeps send disabled from the click until done, even with new text typed", async () => {
    const chat = renderChat()
    const stream = nextStream()

    await chat.typeAndSend("first question")
    expect(chat.sendButton()).toBeDisabled()

    await chat.user.type(chat.textarea(), "follow-up")
    expect(chat.sendButton()).toBeDisabled()

    await stream.delta("partial")
    expect(chat.sendButton()).toBeDisabled()

    await stream.done()
    await waitFor(() => expect(chat.sendButton()).toBeEnabled())
  })
})

describe("ChatView request", () => {
  it("posts to the proxy chat route with role and content only", async () => {
    const chat = renderChat()

    await completeExchange(chat, "why is my loop infinite?", "What ends it?")

    expect(fetchMock.mock.calls[0][0]).toBe(`${PROXY_URL}/api/chat`)
    expect(requestBody(0)).toEqual({ messages: [{ role: "user", content: "why is my loop infinite?" }] })
  })

  it("sends the full history on the next send", async () => {
    const chat = renderChat()
    await completeExchange(chat, "first question", "First reply?")

    await completeExchange(chat, "second question", "Second reply?")

    expect(requestBody(1)).toEqual({
      messages: [
        { role: "user", content: "first question" },
        { role: "tutor", content: "First reply?" },
        { role: "user", content: "second question" },
      ],
    })
  })
})

describe("ChatView errors (AC03)", () => {
  it("recovers from a network failure and sends again", async () => {
    const chat = renderChat()
    await completeExchange(chat, "first question", "First reply?")
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))

    await chat.typeAndSend("second question")

    expect(await screen.findByText(TOAST.network)).toBeInTheDocument()
    expect(chat.userMessages().map((node) => node.textContent)).toEqual(["first question"])
    expect(chat.tutorMessages().map((node) => node.textContent?.trim())).toEqual(["First reply?"])
    expect(chat.textarea()).toHaveValue("second question")

    const stream = nextStream()
    await chat.user.click(chat.sendButton())
    await stream.delta("Second reply?")
    await stream.done()

    await waitFor(() => expect(chat.lastTutorText()).toBe("Second reply?"))
    expect(chat.userMessages()).toHaveLength(2)
    expect(chat.textarea()).toHaveValue("")
  })

  it("shows the upstream_unavailable toast for a 502 and stays usable", async () => {
    const chat = renderChat()
    await completeExchange(chat, "first question", "First reply?")
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { code: "upstream_unavailable", message: "summary" }, requestId: "req-502" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    ))

    await chat.typeAndSend("second question")

    expect(await screen.findByText(TOAST.upstream)).toBeInTheDocument()
    expect(screen.getByText("Request ID: req-502")).toBeInTheDocument()
    expect(chat.userMessages()).toHaveLength(1)
    expect(chat.textarea()).toHaveValue("second question")
    expect(chat.sendButton()).toBeEnabled()
  })

  it("removes the partial reply and restores the input on a mid-stream error", async () => {
    const chat = renderChat()
    const stream = nextStream()

    await chat.typeAndSend("why is my loop infinite?")
    await stream.delta("Partial reply")
    await waitFor(() => expect(chat.lastTutorText()).toBe("Partial reply"))

    await stream.error("upstream_unavailable")

    expect(await screen.findByText(TOAST.upstream)).toBeInTheDocument()
    expect(chat.tutorMessages()).toHaveLength(0)
    expect(chat.userMessages()).toHaveLength(0)
    expect(screen.queryByText("Partial reply")).not.toBeInTheDocument()
    expect(chat.textarea()).toHaveValue("why is my loop infinite?")
    expect(chat.sendButton()).toBeEnabled()
  })

  it("shows the refusal toast when tutor_refused arrives before any delta", async () => {
    const chat = renderChat()
    const stream = nextStream()

    await chat.typeAndSend("just give me the full solution")
    await stream.error("tutor_refused")

    expect(await screen.findByText(TOAST.refused)).toBeInTheDocument()
    expect(chat.tutorMessages()).toHaveLength(0)
    expect(chat.textarea()).toHaveValue("just give me the full solution")
  })
})

describe("ChatView network boundary (AC06, browser part)", () => {
  it("sends every request to the proxy only, across a successful and a failed send", async () => {
    const chat = renderChat()
    await completeExchange(chat, "first question", "First reply?")
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await chat.typeAndSend("second question")
    await screen.findByText(TOAST.network)

    const proxyOrigin = new URL(PROXY_URL).origin
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [input] of fetchMock.mock.calls) {
      const url = String(input)
      expect(url.startsWith(PROXY_URL)).toBe(true)
      expect(new URL(url).origin).toBe(proxyOrigin)
      expect(new URL(url).hostname).not.toContain("anthropic")
    }
  })
})
