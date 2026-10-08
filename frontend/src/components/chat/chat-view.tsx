"use client"

import { GraduationCap } from "lucide-react"
import { MessageInput } from "@/components/chat/message-input"
import { MessageList } from "@/components/chat/message-list"
import { useChat } from "@/hooks/use-chat"
import { canSend } from "@/lib/chat-limit"

// The whole chat page: header, scrolling message list, and the input pinned at the bottom.
export function ChatView() {
  const { messages, status, draft, setDraft, send, isChatFull } = useChat()

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-chat items-center gap-2 px-gutter py-3">
          <GraduationCap aria-hidden="true" className="size-5 text-accent" />
          <h1 className="text-base font-semibold text-foreground">AI Tutor</h1>
        </div>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-chat flex-1 flex-col px-gutter">
        <MessageList messages={messages} status={status} />
        <div className="border-t border-border py-3">
          <MessageInput
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => void send()}
            status={status}
            isChatFull={isChatFull}
            canSend={canSend(messages, draft)}
          />
        </div>
      </main>
    </div>
  )
}
