import { useCallback, useEffect, useReducer, useRef } from "react"
import { toast } from "sonner"
import { ChatError } from "@/lib/chat-error"
import { generateQuiz } from "@/lib/quiz.client"
import { quizToastTextFor } from "@/lib/quiz-error"
import type { Message } from "@/types/chat"
import type { Quiz, QuizStatus } from "@/types/quiz"

type QuizState = {
  status: QuizStatus
  quiz: Quiz | null
  // One entry per question: the chosen option index, or null while unanswered.
  answers: (number | null)[]
  isChecked: boolean
}

type QuizAction =
  | { type: "start" }
  | { type: "succeed", quiz: Quiz }
  | { type: "stop" }
  | { type: "select", questionIndex: number, optionIndex: number }
  | { type: "check" }
  | { type: "retake" }
  | { type: "close" }

const initialState: QuizState = { status: "idle", quiz: null, answers: [], isChecked: false }

function emptyAnswers(quiz: Quiz): (number | null)[] {
  return quiz.questions.map(() => null)
}

function isIndex(value: number, length: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < length
}

function allAnswered(state: QuizState): boolean {
  return state.quiz !== null &&
    state.answers.length === state.quiz.questions.length &&
    state.answers.every((answer) => answer !== null)
}

function canCheckQuiz(state: QuizState): boolean {
  return !state.isChecked && allAnswered(state)
}

function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case "start":
      // A new quiz replaces the previous one, so a failure leaves no quiz open.
      return { status: "generating", quiz: null, answers: [], isChecked: false }
    case "succeed":
      return { status: "idle", quiz: action.quiz, answers: emptyAnswers(action.quiz), isChecked: false }
    case "stop":
      return { ...state, status: "idle" }
    case "select": {
      const question = state.quiz?.questions[action.questionIndex]
      if (
        !state.quiz ||
        state.isChecked ||
        !isIndex(action.questionIndex, state.quiz.questions.length) ||
        !question ||
        !isIndex(action.optionIndex, question.options.length)
      ) {
        return state
      }
      return {
        ...state,
        answers: state.answers.map((answer, index) => (index === action.questionIndex ? action.optionIndex : answer)),
      }
    }
    case "check":
      return canCheckQuiz(state) ? { ...state, isChecked: true } : state
    case "retake":
      return state.quiz ? { ...state, answers: emptyAnswers(state.quiz), isChecked: false } : state
    case "close":
      return { ...state, quiz: null, answers: [], isChecked: false }
  }
}

function showFailureToast(error: unknown) {
  const chatError = error instanceof ChatError ? error : new ChatError("internal_error")
  // Only the fixed table text and the request id; never message content.
  toast.error(
    quizToastTextFor(chatError.code),
    chatError.requestId ? { description: `Request ID: ${chatError.requestId}` } : undefined,
  )
}

export type UseQuiz = {
  status: QuizStatus
  quiz: Quiz | null
  answers: (number | null)[]
  isChecked: boolean
  // A quiz is open, every question has an answer, and it is not checked yet.
  canCheck: boolean
  // The number of right answers once checked, otherwise null.
  score: number | null
  generate: (messages: readonly Message[]) => Promise<void>
  select: (questionIndex: number, optionIndex: number) => void
  check: () => void
  retake: () => void
  close: () => void
}

// Owns the quiz, its request status, and the user's answers. One request at a
// time; a failed request shows one toast and leaves no quiz open.
export function useQuiz(): UseQuiz {
  const [state, dispatch] = useReducer(quizReducer, initialState)
  // The controller of the request in flight. Created per request, never on mount,
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

  const generate = useCallback(async (messages: readonly Message[]) => {
    if (state.status !== "idle" || controllerRef.current) {
      return
    }

    const controller = new AbortController()
    controllerRef.current = controller
    dispatch({ type: "start" })

    try {
      const quiz = await generateQuiz(messages, { signal: controller.signal })
      if (quiz) {
        dispatch({ type: "succeed", quiz })
      } else if (mountedRef.current) {
        // Aborted while still mounted (a Fast Refresh re-ran the effects): stop quietly.
        dispatch({ type: "stop" })
      }
    } catch (error) {
      if (controller.signal.aborted && !mountedRef.current) {
        return
      }
      dispatch({ type: "stop" })
      showFailureToast(error)
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [state.status])

  const select = useCallback((questionIndex: number, optionIndex: number) => {
    dispatch({ type: "select", questionIndex, optionIndex })
  }, [])
  const check = useCallback(() => dispatch({ type: "check" }), [])
  const retake = useCallback(() => dispatch({ type: "retake" }), [])
  const close = useCallback(() => dispatch({ type: "close" }), [])

  const score = state.isChecked && state.quiz
    ? state.quiz.questions.filter((question, index) => state.answers[index] === question.correctOption).length
    : null

  return {
    status: state.status,
    quiz: state.quiz,
    answers: state.answers,
    isChecked: state.isChecked,
    canCheck: canCheckQuiz(state),
    score,
    generate,
    select,
    check,
    retake,
    close,
  }
}
