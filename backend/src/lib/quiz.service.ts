import type Anthropic from '@anthropic-ai/sdk'
import type { ChatMessage } from './chat-request.js'
import { TutorRefusedError } from './chat.service.js'
import { QUIZ_JSON_SCHEMA, quizSchema, type Question, type Quiz } from './quiz-schema.js'
import { QUIZ_SYSTEM_PROMPT } from './quiz-system-prompt.js'

export const QUIZ_MAX_TOKENS = 4096
export const QUIZ_TIMEOUT_MS = 60000
// One try plus one retry, and only for malformed output (AC04).
export const QUIZ_MAX_ATTEMPTS = 2

export const QUIZ_INSTRUCTION = 'Write the quiz from the chat above.'

// The slice of the SDK's request options the service sends. The real client accepts more.
export type QuizRequestOptions = {
  signal?: AbortSignal
  timeout?: number
}

// The slice of the SDK client the service uses. The real client satisfies it, and tests
// pass a fake that needs no network.
export type QuizMessagesClient = {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming, options?: QuizRequestOptions): Promise<Anthropic.Message>
  }
}

export type GeneratedQuiz = {
  quiz: Quiz
  // 1, or 2 when the first response was malformed and the retry succeeded.
  attempts: number
}

// The model returned no usable quiz on every attempt. Carries only the count, never the
// model output, so nothing from the response can reach a log line or the client.
export class QuizMalformedError extends Error {
  override name = 'QuizMalformedError'
  readonly attempts: number

  constructor(attempts: number) {
    super(`The model returned a malformed quiz ${attempts} times`)
    this.attempts = attempts
  }
}

// The chat as one block of data for the model to read. JSON.stringify leaves `<` as it is,
// so a message containing `</chat>` could close the block; every `<` in the JSON text
// becomes the JSON escape \u003c, which still parses back to the original content. The only
// raw `<` left are the two tags added here.
export function toQuizTranscript(messages: ChatMessage[]): string {
  const json = JSON.stringify(messages.map(({ role, content }) => ({ role, content })))
  const escaped = json.replaceAll('<', '\\u003c')
  return `<chat>\n${escaped}\n</chat>\n\n${QUIZ_INSTRUCTION}`
}

type Attempt =
  | { kind: 'valid', quiz: Quiz }
  | { kind: 'malformed' }
  | { kind: 'refusal' }

function classify(response: Anthropic.Message): Attempt {
  if (response.stop_reason === 'refusal') {
    return { kind: 'refusal' }
  }
  // Truncated output may still parse as JSON in rare cases, but it is never trusted.
  if (response.stop_reason === 'max_tokens') {
    return { kind: 'malformed' }
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')
  if (text.trim() === '') {
    return { kind: 'malformed' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'malformed' }
  }

  const result = quizSchema.safeParse(parsed)
  return result.success ? { kind: 'valid', quiz: result.data.quiz } : { kind: 'malformed' }
}

// Fisher-Yates over the options; correctOption follows the correct option's text.
function shuffleOptions(question: Question, random: () => number): Question {
  const order = question.options.map((_, index) => index)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j] as number, order[i] as number]
  }
  return {
    ...question,
    options: order.map(index => question.options[index] as string),
    correctOption: order.indexOf(question.correctOption)
  }
}

export function createQuizService({
  client,
  model,
  random = Math.random
}: {
  client: QuizMessagesClient
  model: string
  random?: () => number
}) {
  return {
    // Calls the model at most twice. Throws QuizMalformedError when no attempt is valid,
    // TutorRefusedError on a refusal (not retried), and SDK errors as they are (the SDK
    // already retries transport errors).
    async generateQuiz(messages: ChatMessage[], { signal }: { signal?: AbortSignal } = {}): Promise<GeneratedQuiz> {
      // The same payload on every attempt, with no feedback about an earlier failure.
      // No `thinking`, `tools`, `temperature`, or `effort` (plan 003, Q1 and Q8).
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: QUIZ_MAX_TOKENS,
        system: QUIZ_SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: QUIZ_JSON_SCHEMA } },
        messages: [{ role: 'user', content: toQuizTranscript(messages) }]
      }
      const options: QuizRequestOptions = signal === undefined
        ? { timeout: QUIZ_TIMEOUT_MS }
        : { signal, timeout: QUIZ_TIMEOUT_MS }

      for (let attempt = 1; attempt <= QUIZ_MAX_ATTEMPTS; attempt++) {
        const result = classify(await client.messages.create(params, options))
        if (result.kind === 'refusal') {
          throw new TutorRefusedError('The model declined to write a quiz')
        }
        if (result.kind === 'valid') {
          return {
            quiz: { questions: result.quiz.questions.map(question => shuffleOptions(question, random)) },
            attempts: attempt
          }
        }
      }

      throw new QuizMalformedError(QUIZ_MAX_ATTEMPTS)
    }
  }
}

export type QuizService = ReturnType<typeof createQuizService>
