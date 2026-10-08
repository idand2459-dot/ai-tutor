import { describe, expect, it } from "vitest"
import {
  canSend,
  isChatFull,
  isDraftTooLong,
  MAX_CHAT_MESSAGES_BEFORE_SEND,
  MAX_CONTENT_LENGTH,
  MAX_REQUEST_MESSAGES,
} from "@/lib/chat-limit"
import type { Message } from "@/types/chat"

// Builds an alternating chat that starts with `user`, as the proxy requires.
function buildChat(length: number): Message[] {
  return Array.from({ length }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? "user" : "tutor",
    content: `content ${index}`,
  }))
}

describe("chat limits", () => {
  it("match the proxy contract", () => {
    expect(MAX_CONTENT_LENGTH).toBe(8000)
    expect(MAX_REQUEST_MESSAGES).toBe(49)
    expect(MAX_CHAT_MESSAGES_BEFORE_SEND).toBe(48)
  })
})

describe("isChatFull", () => {
  it("is false for an empty chat", () => {
    expect(isChatFull([])).toBe(false)
  })

  it("is false at exactly 48 messages", () => {
    expect(isChatFull(buildChat(48))).toBe(false)
  })

  it("is true at 49 messages", () => {
    expect(isChatFull(buildChat(49))).toBe(true)
  })

  it("is true at 50 messages", () => {
    expect(isChatFull(buildChat(50))).toBe(true)
  })
})

describe("isDraftTooLong", () => {
  it("is false at exactly 8,000 characters", () => {
    expect(isDraftTooLong("a".repeat(8000))).toBe(false)
  })

  it("is true at 8,001 characters", () => {
    expect(isDraftTooLong("a".repeat(8001))).toBe(true)
  })

  it("counts surrounding whitespace, as the proxy does", () => {
    expect(isDraftTooLong(` ${"a".repeat(8000)}`)).toBe(true)
  })
})

describe("canSend", () => {
  it("allows a draft in an empty chat", () => {
    expect(canSend([], "why is my loop infinite?")).toBe(true)
  })

  it("allows a draft when the chat has exactly 48 messages", () => {
    expect(canSend(buildChat(48), "one more question")).toBe(true)
  })

  it("blocks a draft when the chat has 49 messages", () => {
    expect(canSend(buildChat(49), "one more question")).toBe(false)
  })

  it("blocks a draft when the chat has 50 messages", () => {
    expect(canSend(buildChat(50), "one more question")).toBe(false)
  })

  it("blocks an empty draft", () => {
    expect(canSend([], "")).toBe(false)
  })

  it("blocks a whitespace-only draft", () => {
    expect(canSend([], " \n\t ")).toBe(false)
  })

  it("allows a draft of exactly 8,000 characters", () => {
    expect(canSend([], "a".repeat(8000))).toBe(true)
  })

  it("blocks a draft of 8,001 characters", () => {
    expect(canSend([], "a".repeat(8001))).toBe(false)
  })
})
