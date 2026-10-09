import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QuizView } from "@/components/quiz/quiz-view"
import type { Quiz } from "@/types/quiz"

// Five questions; the correct option of question i is index i % 4.
const quiz: Quiz = {
  questions: [0, 1, 2, 3, 4].map((index) => ({
    text: `What does loop ${index} check?`,
    options: [`Option A${index}`, `Option B${index}`, `Option C${index}`, `Option D${index}`],
    correctOption: index % 4,
    explanation: `Explanation ${index}: the condition decides.`,
  })),
}

// Keeps the quiz state the way useQuiz does, so QuizView can stay presentational.
function TestHost({ value = quiz, onClose = () => {} }: { value?: Quiz, onClose?: () => void }) {
  const [answers, setAnswers] = useState<(number | null)[]>(value.questions.map(() => null))
  const [isChecked, setIsChecked] = useState(false)
  const canCheck = !isChecked && answers.every((answer) => answer !== null)
  const score = isChecked
    ? value.questions.filter((question, index) => answers[index] === question.correctOption).length
    : null

  return (
    <QuizView
      quiz={value}
      answers={answers}
      isChecked={isChecked}
      canCheck={canCheck}
      score={score}
      onSelect={(questionIndex, optionIndex) =>
        setAnswers((current) => current.map((answer, index) => (index === questionIndex ? optionIndex : answer)))
      }
      onCheck={() => setIsChecked(true)}
      onRetake={() => {
        setAnswers(value.questions.map(() => null))
        setIsChecked(false)
      }}
      onClose={onClose}
    />
  )
}

function groups() {
  return screen.getAllByRole("group")
}

// Picks option `pick(i)` in question i, for every question.
async function answerAll(user: ReturnType<typeof userEvent.setup>, pick: (index: number) => number) {
  const all = groups()
  for (let index = 0; index < all.length; index++) {
    await user.click(within(all[index]).getAllByRole("radio")[pick(index)])
  }
}

const checkButton = () => screen.getByRole("button", { name: "Check answers" })

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, "error")
})

afterEach(() => {
  // No React warnings, such as invalid DOM nesting or missing keys.
  expect(consoleError).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

describe("QuizView before checking", () => {
  it("renders 5 fieldset groups named by the question text, with 4 radios each", () => {
    render(<TestHost />)

    const all = groups()
    expect(all).toHaveLength(5)
    all.forEach((group, index) => {
      expect(group.tagName).toBe("FIELDSET")
      expect(group).toHaveAccessibleName(`What does loop ${index} check?`)
      expect(within(group).getAllByRole("radio")).toHaveLength(4)
    })
  })

  it("shows the options as plain text", () => {
    render(<TestHost />)

    expect(screen.getByRole("radio", { name: "Option A0" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Option D4" })).toBeInTheDocument()
  })

  it("keeps Check answers disabled until all 5 questions are answered", async () => {
    const user = userEvent.setup()
    render(<TestHost />)

    expect(checkButton()).toBeDisabled()
    const all = groups()
    for (let index = 0; index < 4; index++) {
      await user.click(within(all[index]).getAllByRole("radio")[0])
    }
    expect(checkButton()).toBeDisabled()

    await user.click(within(all[4]).getAllByRole("radio")[0])
    expect(checkButton()).toBeEnabled()
  })

  it("shows Check answers and Back to chat, and no Retake quiz, result, or explanation", () => {
    render(<TestHost />)

    expect(checkButton()).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Back to chat" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retake quiz" })).not.toBeInTheDocument()
    expect(screen.queryByText(/You got/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Explanation 0/)).not.toBeInTheDocument()
    expect(screen.queryByText("Correct")).not.toBeInTheDocument()
  })
})

describe("QuizView after checking", () => {
  // Right for questions 0, 1, and 2; wrong for 3 and 4.
  const pick = (index: number) => (index < 3 ? index % 4 : (index + 1) % 4)

  async function checkQuiz() {
    const user = userEvent.setup()
    render(<TestHost />)
    await answerAll(user, pick)
    await user.click(checkButton())
    return user
  }

  it("disables every radio", async () => {
    await checkQuiz()

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled()
    }
  })

  it("says Correct or Incorrect in words on each question, with an icon", async () => {
    await checkQuiz()

    const all = groups()
    for (let index = 0; index < 5; index++) {
      const word = index < 3 ? "Correct" : "Incorrect"
      const result = within(all[index]).getByText(word)
      expect(result.querySelector("svg")).not.toBeNull()
    }
  })

  it("marks the correct option with the words Correct answer, and the wrong choice too", async () => {
    await checkQuiz()

    // Question 3 was answered A3; its correct option is D3.
    const wrong = groups()[3]
    expect(within(wrong).getByText("Correct answer")).toBeInTheDocument()
    expect(within(wrong).getByText("Your answer")).toBeInTheDocument()
    expect(within(wrong).getByRole("radio", { name: "Option D3" })).toHaveAccessibleDescription("Correct answer")
    expect(within(wrong).getByRole("radio", { name: "Option D3" })).not.toBeChecked()
    expect(within(wrong).getByRole("radio", { name: "Option A3" })).toHaveAccessibleDescription("Your answer")
    expect(within(wrong).getByRole("radio", { name: "Option A3" })).toBeChecked()
    expect(within(wrong).getByRole("radio", { name: "Option B3" })).not.toHaveAccessibleDescription()

    // Question 0 was answered A0, which is correct: only Correct answer, no Your answer.
    const right = groups()[0]
    expect(within(right).getByRole("radio", { name: "Option A0" })).toHaveAccessibleDescription("Correct answer")
    expect(within(right).getByRole("radio", { name: "Option A0" })).toBeChecked()
    expect(within(right).queryByText("Your answer")).not.toBeInTheDocument()
  })

  it("shows the explanation of every question", async () => {
    await checkQuiz()

    for (let index = 0; index < 5; index++) {
      expect(screen.getByText(`Explanation ${index}: the condition decides.`)).toBeInTheDocument()
    }
  })

  it("shows the score at the top and moves focus to it", async () => {
    await checkQuiz()

    const summary = screen.getByText("You got 3 of 5 right.")
    expect(summary).toHaveFocus()
    expect(summary).toHaveAttribute("tabindex", "-1")
    // Before every question in document order.
    expect(summary.compareDocumentPosition(groups()[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("hides Check answers and shows Retake quiz and Back to chat", async () => {
    await checkQuiz()

    expect(screen.queryByRole("button", { name: "Check answers" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retake quiz" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Back to chat" })).toBeInTheDocument()
  })
})

describe("QuizView actions", () => {
  it("Retake quiz clears the selections and the results", async () => {
    const user = userEvent.setup()
    render(<TestHost />)
    await answerAll(user, () => 0)
    await user.click(checkButton())

    await user.click(screen.getByRole("button", { name: "Retake quiz" }))

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toBeChecked()
      expect(radio).toBeEnabled()
    }
    expect(screen.queryByText(/You got/)).not.toBeInTheDocument()
    expect(checkButton()).toBeDisabled()
  })

  it("Back to chat calls onClose", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<TestHost onClose={onClose} />)

    await user.click(screen.getByRole("button", { name: "Back to chat" }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe("QuizView safety", () => {
  it("renders no script or img element from a question, an option, or an explanation", async () => {
    const hostile: Quiz = {
      questions: quiz.questions.map((question, index) => ({
        ...question,
        text: `Q${index} <script>alert(1)</script> <img src=x onerror=alert(1)> ![x](https://example.com/a.png)`,
        options: [`<script>alert(2)</script>`, `<img src=x onerror=alert(2)>`, "C", "D"],
        explanation: `<script>alert(3)</script> <img src=x onerror=alert(3)>`,
      })),
    }
    const user = userEvent.setup()
    const { container } = render(<TestHost value={hostile} />)
    await answerAll(user, () => 2)
    await user.click(checkButton())

    expect(container.querySelector("script")).toBeNull()
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getAllByText("<script>alert(2)</script>").length).toBeGreaterThan(0)
  })
})
