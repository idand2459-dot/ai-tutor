// One question of a quiz, as the proxy returns it. `correctOption` is the index
// of the correct option in `options`.
export type Question = {
  text: string
  options: string[]
  correctOption: number
  explanation: string
}

export type Quiz = {
  questions: Question[]
}

// "generating": the quiz request is out and no quiz has arrived yet.
export type QuizStatus = "idle" | "generating"
