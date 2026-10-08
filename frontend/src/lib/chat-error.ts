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
