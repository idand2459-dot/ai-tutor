import { ListChecks, Loader2 } from "lucide-react"

type GenerateQuizButtonProps = {
  onGenerate: () => void
  // canGenerateQuiz(chat, status) and no quiz request in flight, computed by the parent.
  disabled: boolean
  isGenerating: boolean
}

// Presentational: the parent decides when a quiz can be generated. The label stays
// "Generate Quiz" while generating; the spinner and the hidden text announce the wait.
export function GenerateQuizButton({ onGenerate, disabled, isGenerating }: GenerateQuizButtonProps) {
  return (
    <button
      type="button"
      onClick={onGenerate}
      disabled={disabled}
      aria-busy={isGenerating}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-control border border-border bg-surface px-3 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isGenerating ? (
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        <ListChecks aria-hidden="true" className="size-4" />
      )}
      <span>Generate Quiz</span>
      {isGenerating && (
        <>
          {" "}
          <span className="sr-only">Generating quiz</span>
        </>
      )}
    </button>
  )
}
