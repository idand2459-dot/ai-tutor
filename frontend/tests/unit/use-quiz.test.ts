import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { useQuiz } from "@/hooks/use-quiz"
import { ChatError } from "@/lib/chat-error"
import { generateQuiz } from "@/lib/quiz.client"
import type { Message } from "@/types/chat"
import type { Quiz } from "@/types/quiz"

vi.mock("@/lib/quiz.client", () => ({ generateQuiz: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

const generateQuizMock = vi.mocked(generateQuiz)
const toastErrorMock = vi.mocked(toast.error)

const chat: Message[] = [
  { id: "m1", role: "user", content: "why is my loop infinite?" },
  { id: "m2", role: "tutor", content: "What condition ends the loop?" },
]

// Five questions; the correct option of question i is index i % 4.
const quiz: Quiz = {
  questions: [0, 1, 2, 3, 4].map((index) => ({
    text: `Question ${index}?`,
    options: ["A", "B", "C", "D"],
    correctOption: index % 4,
    explanation: `Explanation ${index}.`,
  })),
}

// A stand-in for generateQuiz whose result the test releases by hand. Like the
// real client, it resolves to null when the signal aborts.
function createControlledQuiz() {
  let resolve!: (quiz: Quiz | null) => void
  let reject!: (error: unknown) => void
  let signal: AbortSignal | undefined

  generateQuizMock.mockImplementationOnce((_messages, options) => {
    signal = options?.signal
    return new Promise<Quiz | null>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
      signal?.addEventListener("abort", () => resolvePromise(null))
    })
  })

  return {
    succeed: (value: Quiz = quiz) => resolve(value),
    fail: (error: unknown) => reject(error),
    abort: () => resolve(null),
    signal: () => signal,
  }
}

// Returns the pending request wrapped in an object: returning the bare promise from
// a helper would make `await` wait for the whole request.
function startGenerate(result: { current: ReturnType<typeof useQuiz> }) {
  let generating!: Promise<void>
  act(() => {
    generating = result.current.generate(chat)
  })
  return { generating }
}

// Renders the hook with an open quiz and no answers.
async function openQuiz() {
  const view = renderHook(() => useQuiz())
  const request = createControlledQuiz()
  const { generating } = startGenerate(view.result)
  await act(async () => {
    request.succeed()
    await generating
  })
  return view
}

// Answers question i with `pick(i)`.
function answerAll(result: { current: ReturnType<typeof useQuiz> }, pick: (index: number) => number) {
  act(() => {
    for (let index = 0; index < 5; index++) {
      result.current.select(index, pick(index))
    }
  })
}

beforeEach(() => {
  generateQuizMock.mockReset()
  toastErrorMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useQuiz generate", () => {
  it("starts idle with no quiz", () => {
    const { result } = renderHook(() => useQuiz())

    expect(result.current.status).toBe("idle")
    expect(result.current.quiz).toBeNull()
    expect(result.current.canCheck).toBe(false)
    expect(result.current.score).toBeNull()
  })

  it("becomes generating right away and sends the chat", () => {
    createControlledQuiz()
    const { result } = renderHook(() => useQuiz())

    startGenerate(result)

    expect(result.current.status).toBe("generating")
    expect(generateQuizMock).toHaveBeenCalledTimes(1)
    expect(generateQuizMock.mock.calls[0][0]).toEqual(chat)
  })

  it("opens the quiz with no answers on success", async () => {
    const { result } = await openQuiz()

    expect(result.current.status).toBe("idle")
    expect(result.current.quiz).toEqual(quiz)
    expect(result.current.answers).toEqual([null, null, null, null, null])
    expect(result.current.isChecked).toBe(false)
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it("ignores a second generate while one is in flight", () => {
    createControlledQuiz()
    const { result } = renderHook(() => useQuiz())

    startGenerate(result)
    startGenerate(result)

    expect(generateQuizMock).toHaveBeenCalledTimes(1)
  })

  it("ignores a null result, which means the request was aborted", async () => {
    const request = createControlledQuiz()
    const { result } = renderHook(() => useQuiz())
    const { generating } = startGenerate(result)

    await act(async () => {
      request.abort()
      await generating
    })

    expect(result.current.status).toBe("idle")
    expect(result.current.quiz).toBeNull()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it("can generate again after a success, with a fresh signal", async () => {
    const { result } = await openQuiz()
    const first = generateQuizMock.mock.calls[0][1]?.signal
    const request = createControlledQuiz()

    const { generating } = startGenerate(result)
    await act(async () => {
      request.succeed()
      await generating
    })

    const second = generateQuizMock.mock.calls[1][1]?.signal
    expect(generateQuizMock).toHaveBeenCalledTimes(2)
    expect(second).toBeInstanceOf(AbortSignal)
    expect(second).not.toBe(first)
  })
})

describe("useQuiz failure", () => {
  async function failWith(error: unknown) {
    const request = createControlledQuiz()
    const view = renderHook(() => useQuiz())
    const { generating } = startGenerate(view.result)
    await act(async () => {
      request.fail(error)
      await generating
    })
    return view
  }

  it("shows one toast with the quiz text and the request id, returns to idle, and leaves no quiz", async () => {
    const { result } = await failWith(new ChatError("quiz_malformed", "req-502"))

    expect(result.current.status).toBe("idle")
    expect(result.current.quiz).toBeNull()
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith(
      "The tutor couldn't build a valid quiz. Generate it again.",
      { description: "Request ID: req-502" },
    )
  })

  it("shows no description when the error has no requestId", async () => {
    await failWith(new ChatError("network_error"))

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Can't reach the proxy. Is the backend running on port 4000?",
      undefined,
    )
  })

  it("treats an error that is not a ChatError as internal_error", async () => {
    await failWith(new Error("something unexpected"))

    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith("The proxy hit an unexpected error. Generate the quiz again.", undefined)
  })

  it("discards the previous quiz when a new request fails", async () => {
    const { result } = await openQuiz()
    const request = createControlledQuiz()

    const { generating } = startGenerate(result)
    await act(async () => {
      request.fail(new ChatError("upstream_unavailable"))
      await generating
    })

    expect(result.current.quiz).toBeNull()
  })

  it("can generate again after a failure", async () => {
    const { result } = await failWith(new ChatError("upstream_unavailable"))
    const request = createControlledQuiz()

    const { generating } = startGenerate(result)
    await act(async () => {
      request.succeed()
      await generating
    })

    expect(result.current.quiz).toEqual(quiz)
  })
})

describe("useQuiz answers", () => {
  it("records the chosen option per question and lets the user change it", async () => {
    const { result } = await openQuiz()

    act(() => result.current.select(0, 2))
    act(() => result.current.select(0, 3))
    act(() => result.current.select(4, 1))

    expect(result.current.answers).toEqual([3, null, null, null, 1])
  })

  it("ignores select when there is no quiz", () => {
    const { result } = renderHook(() => useQuiz())

    act(() => result.current.select(0, 0))

    expect(result.current.answers).toEqual([])
  })

  it.each([
    [-1, 0],
    [5, 0],
    [0, -1],
    [0, 4],
    [0.5, 0],
    [0, 1.5],
  ])("ignores select(%s, %s), which is out of range", async (questionIndex, optionIndex) => {
    const { result } = await openQuiz()

    act(() => result.current.select(questionIndex, optionIndex))

    expect(result.current.answers).toEqual([null, null, null, null, null])
  })

  it("ignores select once the quiz is checked", async () => {
    const { result } = await openQuiz()
    answerAll(result, () => 0)
    act(() => result.current.check())

    act(() => result.current.select(0, 3))

    expect(result.current.answers[0]).toBe(0)
  })
})

describe("useQuiz check", () => {
  it("keeps canCheck false and ignores check until all 5 questions are answered", async () => {
    const { result } = await openQuiz()
    act(() => {
      for (let index = 0; index < 4; index++) {
        result.current.select(index, 0)
      }
    })

    expect(result.current.canCheck).toBe(false)
    act(() => result.current.check())

    expect(result.current.isChecked).toBe(false)
    expect(result.current.score).toBeNull()
  })

  it("sets canCheck once all 5 are answered, and check marks the quiz checked", async () => {
    const { result } = await openQuiz()
    answerAll(result, () => 0)

    expect(result.current.canCheck).toBe(true)
    act(() => result.current.check())

    expect(result.current.isChecked).toBe(true)
    expect(result.current.canCheck).toBe(false)
  })

  it("counts the right answers as the score once checked", async () => {
    const { result } = await openQuiz()
    // Right for questions 0, 1, and 2 (correct option i % 4); wrong for 3 and 4.
    answerAll(result, (index) => (index < 3 ? index % 4 : (index + 1) % 4))

    expect(result.current.score).toBeNull()
    act(() => result.current.check())

    expect(result.current.score).toBe(3)
  })

  it("gives a score of 5 when every answer is right", async () => {
    const { result } = await openQuiz()
    answerAll(result, (index) => index % 4)
    act(() => result.current.check())

    expect(result.current.score).toBe(5)
  })
})

describe("useQuiz retake and close", () => {
  it("retake clears the answers and the checked state and keeps the same quiz", async () => {
    const { result } = await openQuiz()
    answerAll(result, () => 0)
    act(() => result.current.check())

    act(() => result.current.retake())

    expect(result.current.quiz).toEqual(quiz)
    expect(result.current.answers).toEqual([null, null, null, null, null])
    expect(result.current.isChecked).toBe(false)
    expect(result.current.score).toBeNull()
  })

  it("close clears the quiz, the answers, and the checked state", async () => {
    const { result } = await openQuiz()
    answerAll(result, () => 0)
    act(() => result.current.check())

    act(() => result.current.close())

    expect(result.current.quiz).toBeNull()
    expect(result.current.answers).toEqual([])
    expect(result.current.isChecked).toBe(false)
    expect(result.current.canCheck).toBe(false)
    expect(result.current.score).toBeNull()
  })
})

describe("useQuiz abort", () => {
  it("aborts the request in flight on unmount, with no toast", async () => {
    const request = createControlledQuiz()
    const { result, unmount } = renderHook(() => useQuiz())
    const { generating } = startGenerate(result)

    unmount()
    await generating

    expect(request.signal()?.aborted).toBe(true)
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it("still generates after a StrictMode mount, unmount, mount cycle", async () => {
    const { StrictMode, createElement } = await import("react")
    createControlledQuiz()
    const { result } = renderHook(() => useQuiz(), {
      wrapper: ({ children }) => createElement(StrictMode, null, children),
    })

    startGenerate(result)

    expect(generateQuizMock).toHaveBeenCalledTimes(1)
    expect(generateQuizMock.mock.calls[0][1]?.signal?.aborted).toBe(false)
    expect(result.current.status).toBe("generating")
  })
})
