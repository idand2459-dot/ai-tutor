import { Loader2 } from "lucide-react"
import { TutorMarkdown } from "@/components/chat/tutor-markdown"
import type { Message } from "@/types/chat"

type MessageItemProps = {
  message: Message
  // True while this tutor message is the one being answered.
  isLoading: boolean
}

export function MessageItem({ message, isLoading }: MessageItemProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end" data-role="user">
        {/* Plain text, never Markdown: what the user typed is shown as typed. */}
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-bubble bg-accent px-4 py-2 text-accent-foreground">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start" data-role="tutor">
      <div className="min-w-0 max-w-full rounded-bubble border border-border bg-surface px-4 py-3 text-foreground">
        {isLoading && message.content === "" ? (
          <div role="status" aria-label="The tutor is thinking" className="flex items-center text-muted">
            <Loader2 aria-hidden="true" className="size-5 animate-spin" />
          </div>
        ) : (
          <TutorMarkdown content={message.content} />
        )}
      </div>
    </div>
  )
}
