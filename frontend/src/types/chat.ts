export type ChatRole = "user" | "tutor"

// One message in the chat. `id` exists only in the browser, for React keys;
// the request body sends `role` and `content` only.
export type Message = {
  id: string
  role: ChatRole
  content: string
}

// A successful event read from the proxy's SSE stream. An SSE `error` event is
// not a ChatEvent: the chat client raises it as a ChatError instead.
export type ChatEvent =
  | { type: "delta", text: string }
  | { type: "done" }
