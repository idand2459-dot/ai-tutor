import { toast } from "sonner"
import { ChatError } from "@/lib/chat-error"

// Shows one toast for a failed request. `textFor` picks the text table: chat
// and quiz failures have their own wording. Anything that is not a ChatError
// is shown as internal_error.
export function showFailureToast(error: unknown, textFor: (code: string) => string) {
  const chatError = error instanceof ChatError ? error : new ChatError("internal_error")
  // Only the fixed table text and the request id; never message content.
  toast.error(
    textFor(chatError.code),
    chatError.requestId ? { description: `Request ID: ${chatError.requestId}` } : undefined,
  )
}
