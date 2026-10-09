"use client"

import { ArrowLeft, RotateCcw } from "lucide-react"
import { useEffect, useId, useRef } from "react"
import { QuizQuestion } from "@/components/quiz/quiz-question"
import type { Quiz } from "@/types/quiz"

type QuizViewProps = {
  quiz: Quiz
  answers: (number | null)[]
  isChecked: boolean
  canCheck: boolean
  // The number of right answers once checked, otherwise null.
  score: number | null
  onSelect: (questionIndex: number, optionIndex: number) => void
  onCheck: () => void
  onRetake: () => void
  onClose: () => void
}

const primaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
const secondaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"

// Presentational: the parent owns the quiz state (useQuiz) and decides what each
// action means.
export function QuizView({ quiz, answers, isChecked, canCheck, score, onSelect, onCheck, onRetake, onClose }: QuizViewProps) {
  const headingId = useId()
  const summaryRef = useRef<HTMLParagraphElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const wasCheckedRef = useRef(isChecked)
  const total = quiz.questions.length

  // The result shows at the top; moving focus there saves scrolling back up.
  // After "Retake quiz" the button is gone, so focus goes to the first option
  // to start again. Focus never moves when the quiz first opens.
  useEffect(() => {
    if (isChecked) {
      summaryRef.current?.focus()
    } else if (wasCheckedRef.current) {
      sectionRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus()
    }
    wasCheckedRef.current = isChecked
  }, [isChecked])

  return (
    <section ref={sectionRef} aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold text-foreground">
          Quiz
        </h2>
        <button type="button" onClick={onClose} className={secondaryButton}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to chat
        </button>
      </div>

      {isChecked && score !== null && (
        <p
          ref={summaryRef}
          tabIndex={-1}
          className="rounded-bubble border border-border bg-surface px-4 py-3 font-medium text-foreground focus-visible:outline-2 focus-visible:outline-accent"
        >
          You got {score} of {total} right.
        </p>
      )}

      {quiz.questions.map((question, index) => (
        <QuizQuestion
          key={index}
          question={question}
          index={index}
          total={total}
          answer={answers[index] ?? null}
          isChecked={isChecked}
          onSelect={(optionIndex) => onSelect(index, optionIndex)}
        />
      ))}

      <div className="flex flex-wrap gap-2">
        {!isChecked && (
          <button type="button" onClick={onCheck} disabled={!canCheck} className={primaryButton}>
            Check answers
          </button>
        )}
        {isChecked && (
          <button type="button" onClick={onRetake} className={primaryButton}>
            <RotateCcw aria-hidden="true" className="size-4" />
            Retake quiz
          </button>
        )}
      </div>
    </section>
  )
}
