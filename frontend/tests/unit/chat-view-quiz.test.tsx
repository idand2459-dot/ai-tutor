import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Toaster, toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatView } from "@/components/chat/chat-view"
import { PROXY_URL } from "@/lib/config"
import { createControlledJsonResponse } from "./helpers/controlled-json-response"
import { createControlledSseResponse, formatSseEvent } from "./helpers/controlled-sse-response"

const fetchMock = vi.fn<typeof fetch>()

const TOAST = {
  quizMalformed: "The tutor couldn't build a valid quiz. Generate it again.",
  network: "Can't reach the proxy. Is the backend running on port 4000?",
}

const quiz = {
  questions: [0, 1, 2, 3, 4].map((index) => ({
    text: `What does loop ${index} check?`,
    options: [`Option A${index}`, `Option B${index}`, `Option C${index}`, `Option D${index}`],
    correctOption: index % 4,
    explanation: `Explanation ${index}.`,
  })),
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  toast.dismiss()
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

function renderChat() {
  const user = userEvent.setup()
  const view = render(
    <>
      <ChatView />
      <Toaster />
    </>,
  )
  const textarea = () => screen.getByRole("textbox", { name: "Message" })
  const sendButton = () => screen.getByRole("button", { name: "Send message" })
  const quizButton = () => screen.getByRole("button", { name: /^Generate Quiz/ })
  const userMessages = () => Array.from(view.container.querySelectorAll("[data-role='user']"))
  const tutorMessages = () => Array.from(view.container.querySelectorAll("[data-role='tutor']"))
  const chatText = () => [...userMessages(), ...tutorMessages()].map((node) => node.textContent?.trim())
  const quizView = () => screen.queryByRole("region", { name: "Quiz" })

  async function typeAndSend(text: string) {
    await user.type(textarea(), text)
    await user.click(sendButton())
  }

  return { user, textarea, sendButton, quizButton, userMessages, tutorMessages, chatText, quizView, typeAndSend }
}

// Queues a controlled SSE response for the next fetch call.
function nextStream() {
  const sse = createControlledSseResponse({ headers: { "X-Request-Id": "req-stream" } })
  fetchMock.mockResolvedValueOnce(sse.response)
  return {
    delta: (text: string) => act(async () => sse.push(formatSseEvent("delta", { text }))),
    done: () => act(async () => {
      sse.push(formatSseEvent("done", {}))
      sse.close()
    }),
  }
}

// Queues a controlled JSON response for the next fetch call.
function nextJson() {
  const json = createControlledJsonResponse()
  fetchMock.mockReturnValueOnce(json.promise)
  return {
    respond: (status: number, body: unknown) => act(async () => json.respond(status, body, { "X-Request-Id": "req-quiz" })),
    fail: () => act(async () => json.fail()),
  }
}

// Completes one exchange so the chat has history.
async function completeExchange(chat: ReturnType<typeof renderChat>, question: string, reply: string) {
  const stream = nextStream()
  await chat.typeAndSend(question)
  await stream.delta(reply)
  await stream.done()
  await waitFor(() => expect(screen.getByRole("log", { name: "Chat" })).toHaveAttribute("aria-busy", "false"))
}

// One exchange, a typed draft, and a quiz request in flight.
async function startQuiz() {
  const chat = renderChat()
  await completeExchange(chat, "why is my loop infinite?", "What ends the loop?")
  await chat.user.type(chat.textarea(), "my next question")
  const before = chat.chatText()
  const response = nextJson()
  await chat.user.click(chat.quizButton())
  return { chat, before, response }
}

describe("ChatView quiz button (AC07)", () => {
  it("is disabled for an empty chat, stays disabled during the first reply, and is enabled after done", async () => {
    const chat = renderChat()
    expect(chat.quizButton()).toBeDisabled()

    const stream = nextStream()
    await chat.typeAndSend("why is my loop infinite?")
    expect(chat.quizButton()).toBeDisabled()

    await stream.delta("What ends")
    await waitFor(() => expect(chat.tutorMessages().at(-1)?.textContent?.trim()).toBe("What ends"))
    expect(chat.quizButton()).toBeDisabled()

    await stream.done()
    await waitFor(() => expect(chat.quizButton()).toBeEnabled())
  })
})

describe("ChatView quiz request", () => {
  it("sends one fetch to the quiz route with the current chat, and shows the loading state", async () => {
    const { chat } = await startQuiz()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe(`${PROXY_URL}/api/quiz`)
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      messages: [
        { role: "user", content: "why is my loop infinite?" },
        { role: "tutor", content: "What ends the loop?" },
      ],
    })

    const button = screen.getByRole("button", { name: "Generate Quiz Generating quiz" })
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(button).toBeDisabled()
    expect(chat.sendButton()).toBeDisabled()
    expect(chat.textarea()).toBeEnabled()
  })

  it("ignores a second click while the quiz is generated", async () => {
    const { chat } = await startQuiz()

    await chat.user.click(chat.quizButton())

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe("ChatView quiz view", () => {
  it("shows the quiz view for a valid quiz, and Back to chat shows the same chat and draft", async () => {
    const { chat, before, response } = await startQuiz()

    await response.respond(200, { quiz })

    expect(await screen.findByRole("region", { name: "Quiz" })).toBeInTheDocument()
    expect(screen.getAllByRole("group")).toHaveLength(5)
    expect(screen.queryByRole("log", { name: "Chat" })).not.toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument()

    await chat.user.click(screen.getByRole("button", { name: "Back to chat" }))

    expect(chat.quizView()).not.toBeInTheDocument()
    expect(chat.chatText()).toEqual(before)
    expect(chat.textarea()).toHaveValue("my next question")
    expect(chat.sendButton()).toBeEnabled()
  })

  it("replaces the previous quiz with a new one", async () => {
    const { chat, response } = await startQuiz()
    await response.respond(200, { quiz })
    await screen.findByRole("region", { name: "Quiz" })

    const second = nextJson()
    await chat.user.click(chat.quizButton())
    expect(chat.quizView()).not.toBeInTheDocument()
    await second.respond(200, { quiz: { questions: quiz.questions.map((question) => ({ ...question, text: `New ${question.text}` })) } })

    expect(await screen.findByRole("group", { name: "New What does loop 0 check?" })).toBeInTheDocument()
    expect(screen.queryByRole("group", { name: "What does loop 0 check?" })).not.toBeInTheDocument()
  })
})

describe("ChatView quiz errors", () => {
  it("shows the quiz_malformed toast once and leaves the chat, the draft, and sending usable (AC04)", async () => {
    const { chat, before, response } = await startQuiz()

    await response.respond(502, { error: { code: "quiz_malformed", message: "summary" }, requestId: "req-502" })

    expect(await screen.findByText(TOAST.quizMalformed)).toBeInTheDocument()
    expect(screen.getAllByText(TOAST.quizMalformed)).toHaveLength(1)
    expect(screen.getByText("Request ID: req-502")).toBeInTheDocument()
    expect(chat.quizView()).not.toBeInTheDocument()
    expect(chat.chatText()).toEqual(before)
    expect(chat.textarea()).toHaveValue("my next question")

    const stream = nextStream()
    await chat.user.click(chat.sendButton())
    await stream.delta("Second reply?")
    await stream.done()
    await waitFor(() => expect(chat.userMessages()).toHaveLength(2))
    expect(chat.textarea()).toHaveValue("")
  })

  it("shows the network_error toast for a rejected fetch, and the chat stays usable", async () => {
    const { chat, before, response } = await startQuiz()

    await response.fail()

    expect(await screen.findByText(TOAST.network)).toBeInTheDocument()
    expect(chat.chatText()).toEqual(before)
    expect(chat.textarea()).toHaveValue("my next question")
    expect(chat.sendButton()).toBeEnabled()
    expect(chat.quizButton()).toBeEnabled()
  })
})

describe("ChatView network boundary with quiz requests (AC06, browser part)", () => {
  it("sends every chat and quiz request to the proxy only", async () => {
    const { chat, response } = await startQuiz()
    await response.respond(200, { quiz })
    await screen.findByRole("region", { name: "Quiz" })
    await chat.user.click(screen.getByRole("button", { name: "Back to chat" }))
    const failed = nextJson()
    await chat.user.click(chat.quizButton())
    await failed.fail()
    await screen.findByText(TOAST.network)

    const proxyOrigin = new URL(PROXY_URL).origin
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [input] of fetchMock.mock.calls) {
      const url = String(input)
      expect(url.startsWith(PROXY_URL)).toBe(true)
      expect(new URL(url).origin).toBe(proxyOrigin)
      expect(new URL(url).hostname).not.toContain("anthropic")
    }
  })
})
