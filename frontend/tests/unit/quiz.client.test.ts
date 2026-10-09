// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatError } from "@/lib/chat-error"
import { PROXY_URL } from "@/lib/config"
import { generateQuiz } from "@/lib/quiz.client"
import type { Message } from "@/types/chat"

const chat: Message[] = [
  { id: "m1", role: "user", content: "why is my loop infinite?" },
  { id: "m2", role: "tutor", content: "What condition ends the loop?" },
]

function question(index: number, overrides: Record<string, unknown> = {}) {
  return {
    text: `Question ${index}: what ends a loop?`,
    options: ["A false condition", "A true condition", "A comment", "A semicolon"],
    correctOption: 0,
    explanation: "The loop stops when its condition becomes false.",
    ...overrides,
  }
}

const validQuiz = { questions: [0, 1, 2, 3, 4].map((index) => question(index)) }

// A valid quiz whose first question has `overrides` applied.
function quizWithFirstQuestion(overrides: Record<string, unknown>) {
  return { questions: [question(0, overrides), ...[1, 2, 3, 4].map((index) => question(index))] }
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

function errorBody(code: string, requestId: string) {
  return { error: { code, message: "human-readable summary" }, requestId }
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": "req-header" },
  })
}

async function captureError(promise: Promise<unknown>): Promise<ChatError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ChatError) {
      return error
    }
    throw error
  }
  throw new Error("expected generateQuiz to throw a ChatError")
}

describe("generateQuiz request", () => {
  it("posts the chat to {PROXY_URL}/api/quiz as role and content only", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { quiz: validQuiz }))

    await generateQuiz(chat)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${PROXY_URL}/api/quiz`)
    expect(init?.method).toBe("POST")
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json")
    expect(JSON.parse(init?.body as string)).toEqual({
      messages: [
        { role: "user", content: "why is my loop infinite?" },
        { role: "tutor", content: "What condition ends the loop?" },
      ],
    })
  })

  it("sends no client-only id field", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { quiz: validQuiz }))

    await generateQuiz(chat)

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    for (const message of body.messages) {
      expect(message).not.toHaveProperty("id")
    }
  })

  it("passes the signal to fetch", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { quiz: validQuiz }))
    const controller = new AbortController()

    await generateQuiz(chat, { signal: controller.signal })

    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal)
  })
})

describe("generateQuiz response", () => {
  it("returns the quiz from a valid 200 body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { quiz: validQuiz }))

    await expect(generateQuiz(chat)).resolves.toEqual(validQuiz)
  })

  it("copies only the known question fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { quiz: quizWithFirstQuestion({ extra: "x" }) }))

    const quiz = await generateQuiz(chat)

    expect(quiz?.questions[0]).not.toHaveProperty("extra")
  })

  it.each([
    ["4 questions", { quiz: { questions: [0, 1, 2, 3].map((index) => question(index)) } }],
    ["6 questions", { quiz: { questions: [0, 1, 2, 3, 4, 5].map((index) => question(index)) } }],
    ["a missing explanation", { quiz: quizWithFirstQuestion({ explanation: undefined }) }],
    ["a missing text", { quiz: quizWithFirstQuestion({ text: undefined }) }],
    ["3 options", { quiz: quizWithFirstQuestion({ options: ["A", "B", "C"] }) }],
    ["a non-string option", { quiz: quizWithFirstQuestion({ options: ["A", "B", "C", 4] }) }],
    ["correctOption 4", { quiz: quizWithFirstQuestion({ correctOption: 4 }) }],
    ["correctOption -1", { quiz: quizWithFirstQuestion({ correctOption: -1 }) }],
    ["correctOption 1.5", { quiz: quizWithFirstQuestion({ correctOption: 1.5 }) }],
    ['correctOption "2"', { quiz: quizWithFirstQuestion({ correctOption: "2" }) }],
    ["no quiz field", { questions: validQuiz.questions }],
    ["a quiz that is not an object", { quiz: "five questions" }],
  ])("raises internal_error for a 200 body with %s", async (_, body) => {
    fetchMock.mockResolvedValue(jsonResponse(200, body))

    const error = await captureError(generateQuiz(chat))

    expect(error.code).toBe("internal_error")
    expect(error.requestId).toBe("req-header")
  })

  it("raises internal_error for a 200 body that is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }))

    expect((await captureError(generateQuiz(chat))).code).toBe("internal_error")
  })
})

describe("generateQuiz failures", () => {
  it.each([
    [400, "validation_error"],
    [422, "tutor_refused"],
    [429, "upstream_rate_limited"],
    [500, "proxy_misconfigured"],
    [500, "internal_error"],
    [502, "quiz_malformed"],
    [502, "upstream_unavailable"],
  ])("raises a ChatError with the code and requestId of a %i %s body", async (status, code) => {
    fetchMock.mockResolvedValue(jsonResponse(status, errorBody(code, "req-body")))

    const error = await captureError(generateQuiz(chat))

    expect(error.code).toBe(code)
    expect(error.requestId).toBe("req-body")
  })

  it("raises internal_error with the header request id for a non-JSON error body", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Bad Gateway</html>", {
      status: 502,
      headers: { "X-Request-Id": "req-header" },
    }))

    const error = await captureError(generateQuiz(chat))

    expect(error.code).toBe("internal_error")
    expect(error.requestId).toBe("req-header")
  })

  it("raises network_error when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))

    const error = await captureError(generateQuiz(chat))

    expect(error.code).toBe("network_error")
    expect(error.requestId).toBeUndefined()
  })
})

describe("generateQuiz abort", () => {
  it("ends quietly when aborted before the response arrives", async () => {
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"))
      })
    }))
    const controller = new AbortController()

    const result = generateQuiz(chat, { signal: controller.signal })
    controller.abort()

    await expect(result).resolves.toBeNull()
  })

  it("ends quietly when aborted while an error response is read", async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(async () => {
      controller.abort()
      return jsonResponse(502, errorBody("upstream_unavailable", "req-body"))
    })

    await expect(generateQuiz(chat, { signal: controller.signal })).resolves.toBeNull()
  })

  it("returns null instead of the quiz when aborted after the response arrives", async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(async () => {
      controller.abort()
      return jsonResponse(200, { quiz: validQuiz })
    })

    await expect(generateQuiz(chat, { signal: controller.signal })).resolves.toBeNull()
  })
})
