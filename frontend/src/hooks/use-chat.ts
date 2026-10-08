import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { toast } from "sonner"
import { streamChat } from "@/lib/chat.client"
import { ChatError, toastTextFor } from "@/lib/chat-error"
import { canSend, isChatFull } from "@/lib/chat-limit"
import type { ChatStatus, Message } from "@/types/chat"

type ChatState = {
  messages: Message[]
  status: ChatStatus
  // The chat as it was before the request in flight, restored on failure.
  previousMessages: Message[] | null
}

type ChatAction =
  | { type: "send", userMessage: Message, tutorMessage: Message }
  | { type: "delta", text: string }
  | { type: "done" }
  | { type: "fail" }

const initialState: ChatState = { messages: [], status: "idle", previousMessages: null }

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send":
      return {
        messages: [...state.messages, action.userMessage, action.tutorMessage],
        status: "sending",
        previousMessages: state.messages,
      }
    case "delta": {
      const last = state.messages.at(-1)
      if (!last || last.role !== "tutor") {
        return state
      }
      return {
        ...state,
        messages: [...state.messages.slice(0, -1), { ...last, content: last.content + action.text }],
        status: "streaming",
      }
    }
    case "done":
      return { ...state, status: "idle", previousMessages: null }
    case "fail":
      return {
        messages: state.previousMessages ?? state.messages,
        status: "idle",
        previousMessages: null,
      }
  }
}

function showFailureToast(error: unknown) {
  const chatError = error instanceof ChatError ? error : new ChatError("internal_error")
  // Only the fixed table text and the request id; never message content.
  toast.error(
    toastTextFor(chatError.code),
    chatError.requestId ? { description: `Request ID: ${chatError.requestId}` } : undefined,
  )
}

export type UseChat = {
  messages: Message[]
  status: ChatStatus
  draft: string
  setDraft: (draft: string) => void
  send: () => Promise<void>
  isChatFull: boolean
}

// Owns the chat, the request status and the draft. One request at a time; a
// failed exchange leaves the chat exactly as it was before sending.
export function useChat(): UseChat {
  const [state, dispatch] = useReducer(chatReducer, initialState)
  const [draft, setDraft] = useState("")
  // The controller of the request in flight. Created per send, never on mount,
  // so React StrictMode's mount, unmount, mount cycle cannot leave a dead one.
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      controllerRef.current?.abort()
    }
  }, [])

  const send = useCallback(async () => {
    if (state.status !== "idle" || controllerRef.current || !canSend(state.messages, draft)) {
      return
    }

    const text = draft
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: text }
    const tutorMessage: Message = { id: crypto.randomUUID(), role: "tutor", content: "" }
    // The old chat plus the new user message; never the empty tutor message.
    const request = [...state.messages, userMessage]
    const controller = new AbortController()
    controllerRef.current = controller

    dispatch({ type: "send", userMessage, tutorMessage })
    setDraft("")

    const restoreDraft = () => setDraft((current) => (current === "" ? text : current))

    try {
      let reply = ""
      for await (const event of streamChat(request, { signal: controller.signal })) {
        if (event.type === "delta") {
          reply += event.text
          dispatch({ type: "delta", text: event.text })
        } else {
          // An empty tutor message would make every later request invalid.
          if (reply.trim() === "") {
            throw new ChatError("internal_error")
          }
          dispatch({ type: "done" })
        }
      }

      if (controller.signal.aborted) {
        // Unmounted: nothing to update. Still mounted (a Fast Refresh re-ran the
        // effects): undo the exchange quietly so the chat stays usable.
        if (mountedRef.current) {
          dispatch({ type: "fail" })
          restoreDraft()
        }
      }
    } catch (error) {
      if (controller.signal.aborted && !mountedRef.current) {
        return
      }
      dispatch({ type: "fail" })
      restoreDraft()
      showFailureToast(error)
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [state.status, state.messages, draft])

  return {
    messages: state.messages,
    status: state.status,
    draft,
    setDraft,
    send,
    isChatFull: isChatFull(state.messages),
  }
}
