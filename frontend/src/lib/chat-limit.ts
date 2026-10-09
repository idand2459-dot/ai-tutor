import type { ChatStatus, Message } from "@/types/chat"

// Limits mirror the proxy's request validation (see the API Contract in .doc/architecture.md).
export const MAX_CONTENT_LENGTH = 8000
export const MAX_REQUEST_MESSAGES = 49
// A request sends the chat plus the new user message, so the chat may hold one less.
export const MAX_CHAT_MESSAGES_BEFORE_SEND = MAX_REQUEST_MESSAGES - 1

export function isChatFull(chat: readonly Message[]): boolean {
  return chat.length > MAX_CHAT_MESSAGES_BEFORE_SEND
}

// Measured on the raw draft, as the proxy measures `content` before trimming.
export function isDraftTooLong(draft: string): boolean {
  return draft.length > MAX_CONTENT_LENGTH
}

export function canSend(chat: readonly Message[], draft: string): boolean {
  return !isChatFull(chat) && draft.trim() !== "" && !isDraftTooLong(draft)
}

// A quiz needs at least one full exchange that has finished: the proxy rejects a
// chat whose last message is not from `tutor`. Whether a quiz is already being
// generated is the caller's check.
export function canGenerateQuiz(chat: readonly Message[], status: ChatStatus): boolean {
  const last = chat.at(-1)
  return status === "idle" && chat.length >= 2 && last?.role === "tutor" && last.content.trim() !== ""
}
