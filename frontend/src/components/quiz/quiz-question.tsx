import { Check, X } from "lucide-react"
import { useId } from "react"
import { TutorMarkdown } from "@/components/chat/tutor-markdown"
import { splitInlineCode } from "@/lib/inline-code"
import type { Question } from "@/types/quiz"

type QuizQuestionProps = {
  question: Question
  // Zero-based position, shown to the user as "Question 1 of 5".
  index: number
  total: number
  // The chosen option index, or null while unanswered.
  answer: number | null
  isChecked: boolean
  onSelect: (optionIndex: number) => void
}

// One question as a group of native radios. The group is named by the question
// text through aria-labelledby, not a <legend>: TutorMarkdown renders block
// elements, which a <legend> must not contain. Question text and explanation are
// model output, so they go through TutorMarkdown; options stay plain text, with
// only inline code rendered as <code>.
export function QuizQuestion({ question, index, total, answer, isChecked, onSelect }: QuizQuestionProps) {
  const id = useId()
  const textId = `${id}-text`
  const isCorrect = answer === question.correctOption

  return (
    <fieldset
      aria-labelledby={textId}
      disabled={isChecked}
      className="min-w-0 rounded-bubble border border-border bg-surface px-4 py-3"
    >
      <p className="text-xs font-medium text-muted">
        Question {index + 1} of {total}
      </p>
      <div id={textId} className="mt-1 text-foreground">
        <TutorMarkdown content={question.text} />
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {question.options.map((option, optionIndex) => {
          const isChosen = answer === optionIndex
          const isCorrectOption = optionIndex === question.correctOption
          const showCorrect = isChecked && isCorrectOption
          const showWrongChoice = isChecked && isChosen && !isCorrectOption
          const markId = `${id}-mark-${optionIndex}`
          return (
            <label
              key={optionIndex}
              data-state={showCorrect ? "correct" : showWrongChoice ? "wrong" : "neutral"}
              className={`flex min-w-0 items-start gap-3 rounded-control border px-3 py-2 text-foreground ${
                showCorrect ? "border-success" : showWrongChoice ? "border-danger" : "border-border"
              } ${isChecked ? "cursor-default" : "cursor-pointer"}`}
            >
              <input
                type="radio"
                name={`${id}-option`}
                value={optionIndex}
                checked={isChosen}
                onChange={() => onSelect(optionIndex)}
                disabled={isChecked}
                aria-describedby={showCorrect || showWrongChoice ? markId : undefined}
                className="mt-1 shrink-0 accent-accent"
              />
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                {splitInlineCode(option).map((segment, segmentIndex) =>
                  segment.type === "code" ? (
                    <code
                      key={segmentIndex}
                      className="rounded-control border border-border bg-background px-1 font-mono text-sm"
                    >
                      {segment.value}
                    </code>
                  ) : (
                    segment.value
                  ),
                )}
              </span>
              {/* Marks describe the radio instead of joining its name, so the name stays the option text. */}
              {showCorrect && (
                <span id={markId} aria-hidden="true" className="shrink-0 text-xs font-medium text-success">
                  Correct answer
                </span>
              )}
              {showWrongChoice && (
                <span id={markId} aria-hidden="true" className="shrink-0 text-xs font-medium text-danger">
                  Your answer
                </span>
              )}
            </label>
          )
        })}
      </div>

      {isChecked && (
        <div className="mt-3 flex flex-col gap-1">
          <p className={`flex items-center gap-1 text-sm font-medium ${isCorrect ? "text-success" : "text-danger"}`}>
            {isCorrect ? <Check aria-hidden="true" className="size-4" /> : <X aria-hidden="true" className="size-4" />}
            {isCorrect ? "Correct" : "Incorrect"}
          </p>
          <div className="text-sm text-foreground">
            <TutorMarkdown content={question.explanation} />
          </div>
        </div>
      )}
    </fieldset>
  )
}
