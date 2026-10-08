"use client"

import { SendHorizontal } from "lucide-react"
import { useId, type FormEvent, type KeyboardEvent } from "react"
import { MAX_CONTENT_LENGTH } from "@/lib/chat-limit"
import type { ChatStatus } from "@/types/chat"

type MessageInputProps = {
  draft: string
  onDraftChange: (draft: string) => void
  onSend: () => void
  status: ChatStatus
  isChatFull: boolean
  // canSend(messages, draft), computed by the parent.
  canSend: boolean
}

const numberFormat = new Intl.NumberFormat("en-US")

// Presentational: the parent owns the draft and decides what sending means.
export function MessageInput({ draft, onDraftChange, onSend, status, isChatFull, canSend }: MessageInputProps) {
  const id = useId()
  const counterId = `${id}-counter`
  const isTooLong = draft.length > MAX_CONTENT_LENGTH
  const isSendAllowed = canSend && status === "idle"

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSendAllowed) {
      onSend()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter adds a new line; Enter that confirms an IME composition is not a send.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return
    }
    event.preventDefault()
    if (isSendAllowed) {
      onSend()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      {isChatFull && (
        <p className="rounded-control border border-border bg-surface px-3 py-2 text-sm text-muted">
          This chat is full. Reload the page to start a new chat.
        </p>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor={id} className="sr-only">
          Message
        </label>
        <textarea
          id={id}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isChatFull}
          rows={1}
          placeholder="Ask about your code…"
          aria-describedby={counterId}
          aria-invalid={isTooLong}
          className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none overflow-y-auto rounded-control border border-border bg-surface px-3 py-2 text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!isSendAllowed}
          aria-label="Send message"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-accent text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SendHorizontal aria-hidden="true" className="size-5" />
        </button>
      </div>
      <div
        id={counterId}
        data-state={isTooLong ? "over-limit" : "within-limit"}
        className={`flex justify-end gap-2 text-xs ${isTooLong ? "text-danger" : "text-muted"}`}
      >
        <span aria-live="polite">{isTooLong ? "Message is too long" : ""}</span>
        <span>
          {numberFormat.format(draft.length)}/{numberFormat.format(MAX_CONTENT_LENGTH)}
        </span>
      </div>
    </form>
  )
}
