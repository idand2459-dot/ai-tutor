import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { useChat } from "@/hooks/use-chat"
import { streamChat } from "@/lib/chat.client"
import { ChatError } from "@/lib/chat-error"
import type { ChatEvent, Message } from "@/types/chat"

vi.mock("@/lib/chat.client", () => ({ streamChat: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

const streamChatMock = vi.mocked(streamChat)
const toastErrorMock = vi.mocked(toast.error)

type Step = { event: ChatEvent } | { error: unknown } | { end: true }

// A stand-in for streamChat whose events the test releases one at a time.
// Like the real client, it ends quietly when the signal aborts.
function createControlledStream() {
  const steps: Step[] = []
  let wake: (() => void) | null = null
  let signal: AbortSignal | undefined

  const push = (step: Step) => {
    steps.push(step)
    wake?.()
  }

  async function* iterate(): AsyncGenerator<ChatEvent, void, undefined> {
    while (true) {
      if (steps.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        wake = null
      }
      const step = steps.shift()!
      if ("error" in step) {
        throw step.error
      }
      if ("end" in step) {
        return
      }
      yield step.event
      // Like the real client, the stream ends right after `done`.
      if (step.event.type === "done") {
        return
      }
    }
  }

  streamChatMock.mockImplementationOnce((_messages, options) => {
    signal = options?.signal
    signal?.addEventListener("abort", () => push({ end: true }))
    return iterate()
  })

  return {
    delta: (text: string) => push({ event: { type: "delta", text } }),
    done: () => push({ event: { type: "done" } }),
    fail: (error: unknown) => push({ error }),
    signal: () => signal,
  }
}

function contentOf(messages: Message[]) {
  return messages.map(({ role, content }) => ({ role, content }))
}

// Returns the pending send wrapped in an object: returning the bare promise from an
// async helper would make `await` wait for the whole request.
function typeAndSend(result: { current: ReturnType<typeof useChat> }, text: string) {
  act(() => result.current.setDraft(text))
  let sending!: Promise<void>
  act(() => {
    sending = result.current.send()
  })
  return { sending }
}

// Completes one successful exchange so the chat has history.
async function completeExchange(result: { current: ReturnType<typeof useChat> }, question: string, reply: string) {
  const stream = createControlledStream()
  const { sending } = typeAndSend(result, question)
  await act(async () => {
    stream.delta(reply)
    stream.done()
    await sending
  })
}

beforeEach(() => {
  streamChatMock.mockReset()
  toastErrorMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useChat send", () => {
  it("adds the user message and an empty tutor message, and becomes sending right away", async () => {
    createControlledStream()
    const { result } = renderHook(() => useChat())

    typeAndSend(result, "why is my loop infinite?")

    expect(result.current.status).toBe("sending")
    expect(contentOf(result.current.messages)).toEqual([
      { role: "user", content: "why is my loop infinite?" },
      { role: "tutor", content: "" },
    ])
    expect(result.current.messages[0].id).not.toBe(result.current.messages[1].id)
  })

  it("clears the draft on send", async () => {
    createControlledStream()
    const { result } = renderHook(() => useChat())

    typeAndSend(result, "a question")

    expect(result.current.draft).toBe("")
  })

  it("sends the history plus the new user message, exactly as typed, without the empty tutor message", async () => {
    const { result } = renderHook(() => useChat())
    await completeExchange(result, "first question", "First reply?")
    createControlledStream()

    typeAndSend(result, "  second question  ")

    expect(streamChatMock).toHaveBeenCalledTimes(2)
    const sent = streamChatMock.mock.calls[1][0]
    expect(contentOf([...sent])).toEqual([
      { role: "user", content: "first question" },
      { role: "tutor", content: "First reply?" },
      { role: "user", content: "  second question  " },
    ])
  })

  it("ignores send for an empty or whitespace-only draft", async () => {
    const { result } = renderHook(() => useChat())

    typeAndSend(result, "")
    typeAndSend(result, "   ")

    expect(streamChatMock).not.toHaveBeenCalled()
    expect(result.current.messages).toEqual([])
    expect(result.current.status).toBe("idle")
  })

  it("ignores send while a reply is streaming", async () => {
    const stream = createControlledStream()
    const { result } = renderHook(() => useChat())
    typeAndSend(result, "first")
    await act(async () => stream.delta("partial"))
    await waitFor(() => expect(result.current.status).toBe("streaming"))

    typeAndSend(result, "second")

    expect(streamChatMock).toHaveBeenCalledTimes(1)
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.draft).toBe("second")
  })

  it("reports isChatFull as false for a new chat", () => {
    const { result } = renderHook(() => useChat())

    expect(result.current.isChatFull).toBe(false)
  })
})

describe("useChat streaming", () => {
  it("appends each delta to the last tutor message only, then returns to idle on done", async () => {
    const { result } = renderHook(() => useChat())
    await completeExchange(result, "first question", "First reply?")
    const stream = createControlledStream()
    const { sending } = typeAndSend(result, "second question")

    await act(async () => stream.delta("What "))
    await waitFor(() => expect(result.current.status).toBe("streaming"))
    expect(result.current.messages.at(-1)?.content).toBe("What ")

    await act(async () => stream.delta("ends it?"))
    await waitFor(() => expect(result.current.messages.at(-1)?.content).toBe("What ends it?"))

    await act(async () => {
      stream.done()
      await sending
    })

    expect(result.current.status).toBe("idle")
    expect(contentOf(result.current.messages)).toEqual([
      { role: "user", content: "first question" },
      { role: "tutor", content: "First reply?" },
      { role: "user", content: "second question" },
      { role: "tutor", content: "What ends it?" },
    ])
    expect(toastErrorMock).not.toHaveBeenCalled()
  })
})

describe("useChat failure", () => {
  async function setUpFailure() {
    const view = renderHook(() => useChat())
    await completeExchange(view.result, "first question", "First reply?")
    const before = view.result.current.messages
    const stream = createControlledStream()
    const { sending } = typeAndSend(view.result, "my question")
    return { ...view, before, stream, sending }
  }

  it("restores the chat and the draft when the request fails before any delta", async () => {
    const { result, before, stream, sending } = await setUpFailure()

    await act(async () => {
      stream.fail(new ChatError("upstream_rate_limited", "req-429"))
      await sending
    })

    expect(result.current.messages).toEqual(before)
    expect(result.current.draft).toBe("my question")
    expect(result.current.status).toBe("idle")
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith(
      "The tutor is busy. Wait a moment, then send again.",
      { description: "Request ID: req-429" },
    )
  })

  it("restores the chat and the draft when the stream fails after a delta", async () => {
    const { result, before, stream, sending } = await setUpFailure()
    await act(async () => stream.delta("partial reply"))
    await waitFor(() => expect(result.current.status).toBe("streaming"))

    await act(async () => {
      stream.fail(new ChatError("upstream_unavailable", "req-mid"))
      await sending
    })

    expect(result.current.messages).toEqual(before)
    expect(result.current.draft).toBe("my question")
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith(
      "The tutor is unreachable right now. Send again in a moment.",
      { description: "Request ID: req-mid" },
    )
  })

  it("restores the chat and the draft on tutor_refused", async () => {
    const { result, before, stream, sending } = await setUpFailure()

    await act(async () => {
      stream.fail(new ChatError("tutor_refused", "req-refused"))
      await sending
    })

    expect(result.current.messages).toEqual(before)
    expect(result.current.draft).toBe("my question")
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith(
      "The tutor declined to answer. Try rephrasing your message.",
      { description: "Request ID: req-refused" },
    )
  })

  it("keeps new text the user typed during the request", async () => {
    const { result, stream, sending } = await setUpFailure()
    act(() => result.current.setDraft("a newer question"))

    await act(async () => {
      stream.fail(new ChatError("upstream_unavailable"))
      await sending
    })

    expect(result.current.draft).toBe("a newer question")
  })

  it("shows no description when the error has no requestId", async () => {
    const { stream, sending } = await setUpFailure()

    await act(async () => {
      stream.fail(new ChatError("network_error"))
      await sending
    })

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Can't reach the proxy. Is the backend running on port 4000?",
      undefined,
    )
  })

  it("treats an error that is not a ChatError as internal_error", async () => {
    const { result, before, stream, sending } = await setUpFailure()

    await act(async () => {
      stream.fail(new Error("something unexpected"))
      await sending
    })

    expect(result.current.messages).toEqual(before)
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith("The proxy hit an unexpected error. Send again.", undefined)
  })

  it("treats done without any reply text as internal_error", async () => {
    const { result, before, stream, sending } = await setUpFailure()

    await act(async () => {
      stream.done()
      await sending
    })

    expect(result.current.messages).toEqual(before)
    expect(result.current.draft).toBe("my question")
    expect(toastErrorMock).toHaveBeenCalledWith("The proxy hit an unexpected error. Send again.", undefined)
  })

  it("never puts message content in the toast", async () => {
    const { stream, sending } = await setUpFailure()

    await act(async () => {
      stream.fail(new ChatError("validation_error", "req-400"))
      await sending
    })

    const [title, options] = toastErrorMock.mock.calls[0]
    expect(String(title)).not.toContain("my question")
    expect(JSON.stringify(options)).not.toContain("my question")
  })

  it("can send again after a failure", async () => {
    const { result, stream, sending } = await setUpFailure()
    await act(async () => {
      stream.fail(new ChatError("upstream_unavailable"))
      await sending
    })

    await completeExchange(result, "my question", "Second reply?")

    expect(result.current.messages).toHaveLength(4)
    expect(result.current.status).toBe("idle")
  })
})

describe("useChat abort", () => {
  it("aborts the request in flight on unmount, with no toast", async () => {
    const stream = createControlledStream()
    const { result, unmount } = renderHook(() => useChat())
    const { sending } = typeAndSend(result, "a question")

    unmount()
    await sending

    expect(stream.signal()?.aborted).toBe(true)
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it("passes a fresh signal on every send", async () => {
    const { result } = renderHook(() => useChat())
    await completeExchange(result, "first", "One?")
    const first = streamChatMock.mock.calls[0][1]?.signal
    await completeExchange(result, "second", "Two?")
    const second = streamChatMock.mock.calls[1][1]?.signal

    expect(first).toBeInstanceOf(AbortSignal)
    expect(second).toBeInstanceOf(AbortSignal)
    expect(second).not.toBe(first)
    expect(second?.aborted).toBe(false)
  })

  it("still sends after a StrictMode mount, unmount, mount cycle", async () => {
    const { StrictMode, createElement } = await import("react")
    createControlledStream()
    const { result } = renderHook(() => useChat(), {
      wrapper: ({ children }) => createElement(StrictMode, null, children),
    })

    typeAndSend(result, "a question")

    expect(streamChatMock).toHaveBeenCalledTimes(1)
    expect(streamChatMock.mock.calls[0][1]?.signal?.aborted).toBe(false)
    expect(result.current.status).toBe("sending")
  })
})
