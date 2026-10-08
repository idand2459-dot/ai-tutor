import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { MessageInput } from "@/components/chat/message-input"
import type { ChatStatus } from "@/types/chat"

type Props = Partial<{
  draft: string
  status: ChatStatus
  isChatFull: boolean
  canSend: boolean
}>

function renderInput({ draft = "a question", status = "idle", isChatFull = false, canSend = true }: Props = {}) {
  const onSend = vi.fn()
  const onDraftChange = vi.fn()
  render(
    <MessageInput
      draft={draft}
      onDraftChange={onDraftChange}
      onSend={onSend}
      status={status}
      isChatFull={isChatFull}
      canSend={canSend}
    />,
  )
  return {
    onSend,
    onDraftChange,
    textarea: screen.getByRole("textbox", { name: "Message" }),
    button: screen.getByRole("button", { name: "Send message" }),
  }
}

describe("MessageInput send button", () => {
  it("is enabled for sendable text while idle", () => {
    const { button } = renderInput()

    expect(button).toBeEnabled()
  })

  // The parent passes canSend = false for these drafts (see chat-limit.ts).
  it.each([
    ["empty", ""],
    ["whitespace-only", "   "],
    ["over-limit", "a".repeat(8001)],
  ])("is disabled for %s text", (_case, draft) => {
    const { button } = renderInput({ draft, canSend: false })

    expect(button).toBeDisabled()
  })

  it.each<ChatStatus>(["sending", "streaming"])("is disabled while %s", (status) => {
    const { button } = renderInput({ status })

    expect(button).toBeDisabled()
  })

  it("is disabled for a full chat", () => {
    const { button } = renderInput({ isChatFull: true, canSend: false })

    expect(button).toBeDisabled()
  })

  it("calls onSend once when clicked", async () => {
    const user = userEvent.setup()
    const { button, onSend } = renderInput()

    await user.click(button)

    expect(onSend).toHaveBeenCalledTimes(1)
  })
})

describe("MessageInput keyboard", () => {
  it("sends once on Enter", async () => {
    const user = userEvent.setup()
    const { textarea, onSend } = renderInput()

    await user.click(textarea)
    await user.keyboard("{Enter}")

    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it("does not send on Shift+Enter", async () => {
    const user = userEvent.setup()
    const { textarea, onSend, onDraftChange } = renderInput()

    await user.click(textarea)
    await user.keyboard("{Shift>}{Enter}{/Shift}")

    expect(onSend).not.toHaveBeenCalled()
    expect(onDraftChange).toHaveBeenCalledWith("a question\n")
  })

  it("does not send on Enter while sending is not allowed", async () => {
    const user = userEvent.setup()
    const { textarea, onSend, onDraftChange } = renderInput({ status: "streaming" })

    await user.click(textarea)
    await user.keyboard("{Enter}")

    expect(onSend).not.toHaveBeenCalled()
    expect(onDraftChange).not.toHaveBeenCalled()
  })

  it("does not send on Enter during an IME composition", () => {
    const { textarea, onSend } = renderInput()

    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true })

    expect(onSend).not.toHaveBeenCalled()
  })
})

describe("MessageInput textarea", () => {
  it("passes typed text to onDraftChange", () => {
    const { textarea, onDraftChange } = renderInput({ draft: "" })

    fireEvent.change(textarea, { target: { value: "why is my loop infinite?" } })

    expect(onDraftChange).toHaveBeenCalledWith("why is my loop infinite?")
  })

  it("stays editable while the tutor streams", () => {
    const { textarea } = renderInput({ status: "streaming" })

    expect(textarea).toBeEnabled()
  })

  it("is disabled when the chat is full", () => {
    const { textarea } = renderInput({ isChatFull: true, canSend: false })

    expect(textarea).toBeDisabled()
  })
})

describe("MessageInput counter", () => {
  it("shows used and maximum characters", () => {
    renderInput({ draft: "hello" })

    expect(screen.getByText("5/8,000")).toBeInTheDocument()
    expect(screen.queryByText("Message is too long")).not.toBeInTheDocument()
  })

  it("switches to its over-limit state at 8,001 characters", () => {
    renderInput({ draft: "a".repeat(8001), canSend: false })

    expect(screen.getByText("8,001/8,000")).toBeInTheDocument()
    expect(screen.getByText("Message is too long")).toBeInTheDocument()
    expect(screen.getByText("Message is too long").closest("[data-state]")).toHaveAttribute(
      "data-state",
      "over-limit",
    )
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveAttribute("aria-invalid", "true")
  })

  it("stays within the limit at exactly 8,000 characters", () => {
    renderInput({ draft: "a".repeat(8000) })

    expect(screen.getByText("8,000/8,000").closest("[data-state]")).toHaveAttribute(
      "data-state",
      "within-limit",
    )
  })
})

describe("MessageInput full chat", () => {
  it("shows the full-chat notice", () => {
    renderInput({ isChatFull: true, canSend: false })

    expect(screen.getByText("This chat is full. Reload the page to start a new chat.")).toBeInTheDocument()
  })

  it("hides the notice while the chat has room", () => {
    renderInput()

    expect(screen.queryByText(/This chat is full/)).not.toBeInTheDocument()
  })
})
