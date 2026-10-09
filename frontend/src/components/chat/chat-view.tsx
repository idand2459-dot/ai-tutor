"use client"

import { GraduationCap } from "lucide-react"
import { MessageInput } from "@/components/chat/message-input"
import { MessageList } from "@/components/chat/message-list"
import { GenerateQuizButton } from "@/components/quiz/generate-quiz-button"
import { QuizView } from "@/components/quiz/quiz-view"
import { useChat } from "@/hooks/use-chat"
import { useQuiz } from "@/hooks/use-quiz"
import { canGenerateQuiz, canSend } from "@/lib/chat-limit"

// The whole chat page: header, scrolling message list, and the input pinned at the bottom.
// While a quiz is open it replaces the list and the input; the chat and the draft stay in
// state here, so "Back to chat" shows them unchanged.
export function ChatView() {
  const { messages, status, draft, setDraft, send, isChatFull } = useChat()
  const quiz = useQuiz()
  const isGenerating = quiz.status === "generating"

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-chat items-center justify-between gap-2 px-gutter py-3">
          <div className="flex min-w-0 items-center gap-2">
            <GraduationCap aria-hidden="true" className="size-5 shrink-0 text-accent" />
            <h1 className="text-base font-semibold text-foreground">AI Tutor</h1>
          </div>
          <GenerateQuizButton
            onGenerate={() => void quiz.generate(messages)}
            disabled={isGenerating || !canGenerateQuiz(messages, status)}
            isGenerating={isGenerating}
          />
        </div>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-chat flex-1 flex-col px-gutter">
        {quiz.quiz ? (
          <QuizView
            quiz={quiz.quiz}
            answers={quiz.answers}
            isChecked={quiz.isChecked}
            canCheck={quiz.canCheck}
            score={quiz.score}
            onSelect={quiz.select}
            onCheck={quiz.check}
            onRetake={quiz.retake}
            onClose={quiz.close}
          />
        ) : (
          <>
            <MessageList messages={messages} status={status} />
            <div className="border-t border-border py-3">
              <MessageInput
                draft={draft}
                onDraftChange={setDraft}
                onSend={() => void send()}
                status={status}
                isChatFull={isChatFull}
                // No send while a quiz is generated, so the chat cannot change under the request.
                canSend={!isGenerating && canSend(messages, draft)}
              />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
