"use client"

import { GraduationCap } from "lucide-react"
import { useEffect, useRef } from "react"
import { MessageItem } from "@/components/chat/message-item"
import type { ChatStatus, Message } from "@/types/chat"

type MessageListProps = {
  messages: Message[]
  status: ChatStatus
}

export function MessageList({ messages, status }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null)

  // `messages` changes on every new message and every delta, so the newest
  // text stays in view while the tutor streams.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [messages])

  const lastIndex = messages.length - 1

  return (
    <div
      role="log"
      aria-label="Chat"
      aria-busy={status !== "idle"}
      className="flex flex-1 flex-col gap-4 overflow-y-auto py-4"
    >
      {messages.length === 0 ? (
        <div className="m-auto flex max-w-md flex-col items-center gap-3 px-gutter text-center text-muted">
          <GraduationCap aria-hidden="true" className="size-8" />
          <p className="text-lg font-medium text-foreground">Ask a coding question to get started.</p>
          <p>
            The tutor won&apos;t hand you the answer. It guides you with questions, so you can
            work it out yourself.
          </p>
        </div>
      ) : (
        messages.map((message, index) => (
          <MessageItem
            key={message.id}
            message={message}
            isLoading={index === lastIndex && message.role === "tutor" && status !== "idle"}
          />
        ))
      )}
      <div ref={endRef} aria-hidden="true" />
    </div>
  )
}
