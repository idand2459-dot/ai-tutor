import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MessageList } from "@/components/chat/message-list"
import type { ChatStatus, Message } from "@/types/chat"

const question: Message = { id: "m1", role: "user", content: "why is my loop infinite?" }
const answer: Message = { id: "m2", role: "tutor", content: "What **condition** ends the loop?" }
const emptyTutor: Message = { id: "m3", role: "tutor", content: "" }

function renderList(messages: Message[], status: ChatStatus = "idle") {
  return render(<MessageList messages={messages} status={status} />)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("MessageList empty state", () => {
  it("invites the user to ask a coding question when the chat is empty", () => {
    renderList([])

    expect(screen.getByText("Ask a coding question to get started.")).toBeInTheDocument()
    expect(screen.getByText(/guides you with questions/)).toBeInTheDocument()
  })

  it("hides the empty state once the chat has a message", () => {
    renderList([question])

    expect(screen.queryByText("Ask a coding question to get started.")).not.toBeInTheDocument()
  })
})

describe("MessageList messages", () => {
  it("renders user content as plain text, so Markdown stays literal", () => {
    const { container } = renderList([{ id: "m1", role: "user", content: "**x**" }])

    expect(screen.getByText("**x**")).toBeInTheDocument()
    expect(container.querySelector("strong")).toBeNull()
  })

  it("renders tutor content as Markdown", () => {
    const { container } = renderList([question, answer])

    expect(container.querySelector("[data-role='tutor'] strong")).toHaveTextContent("condition")
  })

  it("aligns user messages to the end and tutor messages to the start", () => {
    const { container } = renderList([question, answer])

    expect(container.querySelector("[data-role='user']")).toHaveClass("justify-end")
    expect(container.querySelector("[data-role='tutor']")).toHaveClass("justify-start")
  })
})

describe("MessageList loading indicator", () => {
  it.each<ChatStatus>(["sending", "streaming"])(
    "shows while the last tutor message is empty and the status is %s",
    (status) => {
      renderList([question, emptyTutor], status)

      expect(screen.getByRole("status", { name: "The tutor is thinking" })).toBeInTheDocument()
    },
  )

  it("disappears once reply text arrives", () => {
    const { rerender } = renderList([question, emptyTutor], "sending")

    rerender(<MessageList messages={[question, { ...emptyTutor, content: "What" }]} status="streaming" />)

    expect(screen.queryByRole("status", { name: "The tutor is thinking" })).not.toBeInTheDocument()
    expect(screen.getByText("What")).toBeInTheDocument()
  })

  it("does not show when the status is idle", () => {
    renderList([question, emptyTutor], "idle")

    expect(screen.queryByRole("status", { name: "The tutor is thinking" })).not.toBeInTheDocument()
  })

  it("belongs to the last tutor message only", () => {
    const earlierEmpty: Message = { id: "m0", role: "tutor", content: "" }
    renderList([question, earlierEmpty, { id: "m4", role: "user", content: "next" }], "sending")

    expect(screen.queryByRole("status", { name: "The tutor is thinking" })).not.toBeInTheDocument()
  })
})

describe("MessageList accessibility", () => {
  it("is a log that is busy while a reply is pending", () => {
    const { rerender } = renderList([question, emptyTutor], "sending")

    expect(screen.getByRole("log", { name: "Chat" })).toHaveAttribute("aria-busy", "true")

    rerender(<MessageList messages={[question, answer]} status="idle" />)

    expect(screen.getByRole("log", { name: "Chat" })).toHaveAttribute("aria-busy", "false")
  })
})

describe("MessageList auto-scroll", () => {
  it("scrolls to the newest message when a message is added", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView")
    const { rerender } = renderList([question])
    scrollIntoView.mockClear()

    rerender(<MessageList messages={[question, answer]} status="idle" />)

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })
})
