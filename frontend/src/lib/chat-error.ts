// The six `error.code` values in the proxy contract, plus `network_error`, which
// exists only in the browser: the request never reached the proxy, or the
// connection to it broke.
export type ChatErrorCode =
  | "validation_error"
  | "upstream_rate_limited"
  | "proxy_misconfigured"
  | "upstream_unavailable"
  | "tutor_refused"
  | "internal_error"
  | "network_error"

// A failed chat request. `code` keeps an unknown code from the proxy as its raw
// string, so the UI can still fall back to a generic message for it.
export class ChatError extends Error {
  readonly code: ChatErrorCode | (string & Record<never, never>)
  readonly requestId?: string

  constructor(code: ChatErrorCode | (string & Record<never, never>), requestId?: string) {
    super(`Chat request failed: ${code}`)
    this.name = "ChatError"
    this.code = code
    this.requestId = requestId
  }
}

// The only text a chat failure shows the user. The server's `error.message` is
// never shown, so the wording stays stable and testable. `satisfies` makes a
// missing code a compile error.
const TOAST_TEXT = {
  validation_error: "Message couldn't be sent. Check its length and try again.",
  upstream_rate_limited: "The tutor is busy. Wait a moment, then send again.",
  proxy_misconfigured: "The proxy isn't set up correctly. Check the backend API key and model.",
  upstream_unavailable: "The tutor is unreachable right now. Send again in a moment.",
  tutor_refused: "The tutor declined to answer. Try rephrasing your message.",
  internal_error: "The proxy hit an unexpected error. Send again.",
  network_error: "Can't reach the proxy. Is the backend running on port 4000?",
} as const satisfies Record<ChatErrorCode, string>

// Returns the toast text for a code. An unknown code gets the internal_error text.
export function toastTextFor(code: string): string {
  return Object.hasOwn(TOAST_TEXT, code)
    ? TOAST_TEXT[code as ChatErrorCode]
    : TOAST_TEXT.internal_error
}
