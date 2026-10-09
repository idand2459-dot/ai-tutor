import { readErrorResponse } from "@/lib/chat.client"
import { ChatError } from "@/lib/chat-error"
import { PROXY_URL } from "@/lib/config"
import type { Message } from "@/types/chat"
import type { Question, Quiz } from "@/types/quiz"

export const QUESTION_COUNT = 5
export const OPTION_COUNT = 4

export type GenerateQuizOptions = {
  signal?: AbortSignal
}

// Sends the whole chat to the proxy and returns the quiz built from it. Throws a
// ChatError on any failure, and returns null, with no error, when `signal`
// aborts. It never retries and never logs message content.
export async function generateQuiz(
  messages: readonly Message[],
  { signal }: GenerateQuizOptions = {},
): Promise<Quiz | null> {
  let response: Response
  try {
    response = await fetch(`${PROXY_URL}/api/quiz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Only role and content: the client-only id must not reach the proxy.
      body: JSON.stringify({ messages: messages.map(({ role, content }) => ({ role, content })) }),
      signal,
    })
  } catch {
    if (signal?.aborted) {
      return null
    }
    throw new ChatError("network_error")
  }

  const headerRequestId = response.headers.get("X-Request-Id") ?? undefined

  if (!response.ok) {
    const error = await readErrorResponse(response, headerRequestId)
    if (signal?.aborted) {
      return null
    }
    throw error
  }

  let text: string
  try {
    text = await response.text()
  } catch {
    if (signal?.aborted) {
      return null
    }
    throw new ChatError("network_error", headerRequestId)
  }

  if (signal?.aborted) {
    return null
  }

  const quiz = toQuiz(parseJson(text))
  if (!quiz) {
    throw new ChatError("internal_error", headerRequestId)
  }
  return quiz
}

// Reads the `{ quiz: { questions } }` body. Returns null unless the full shape
// matches: exactly 5 questions, each with a string text, exactly 4 string
// options, an integer correctOption from 0 to 3, and a string explanation.
// Copies only the known fields.
function toQuiz(body: unknown): Quiz | null {
  if (!isRecord(body) || !isRecord(body.quiz) || !Array.isArray(body.quiz.questions)) {
    return null
  }
  const { questions } = body.quiz
  if (questions.length !== QUESTION_COUNT) {
    return null
  }
  const parsed = questions.map(toQuestion)
  return parsed.every((question) => question !== null) ? { questions: parsed as Question[] } : null
}

function toQuestion(value: unknown): Question | null {
  if (
    !isRecord(value) ||
    typeof value.text !== "string" ||
    !Array.isArray(value.options) ||
    value.options.length !== OPTION_COUNT ||
    !value.options.every((option) => typeof option === "string") ||
    typeof value.correctOption !== "number" ||
    !Number.isInteger(value.correctOption) ||
    value.correctOption < 0 ||
    value.correctOption >= OPTION_COUNT ||
    typeof value.explanation !== "string"
  ) {
    return null
  }
  return {
    text: value.text,
    options: [...value.options],
    correctOption: value.correctOption,
    explanation: value.explanation,
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
