import type { ChatErrorCode } from "@/lib/chat-error"

// The only text a quiz failure shows the user (plan 003, Q4). Like the chat
// table, the server's `error.message` is never shown. `satisfies` makes a
// missing code a compile error.
const QUIZ_TOAST_TEXT = {
  validation_error: "This chat can't be turned into a quiz. Reload the page to start a new chat.",
  upstream_rate_limited: "The tutor is busy. Wait a moment, then generate the quiz again.",
  proxy_misconfigured: "The proxy isn't set up correctly. Check the backend API key and model.",
  upstream_unavailable: "The tutor is unreachable right now. Generate the quiz again in a moment.",
  tutor_refused: "The tutor declined to build a quiz from this chat.",
  quiz_malformed: "The tutor couldn't build a valid quiz. Generate it again.",
  internal_error: "The proxy hit an unexpected error. Generate the quiz again.",
  network_error: "Can't reach the proxy. Is the backend running on port 4000?",
} as const satisfies Record<ChatErrorCode, string>

// Returns the toast text for a quiz failure. An unknown code gets the internal_error text.
export function quizToastTextFor(code: string): string {
  return Object.hasOwn(QUIZ_TOAST_TEXT, code)
    ? QUIZ_TOAST_TEXT[code as ChatErrorCode]
    : QUIZ_TOAST_TEXT.internal_error
}
