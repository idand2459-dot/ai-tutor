import { z } from 'zod'

export const QUESTION_COUNT = 5
export const OPTION_COUNT = 4
export const MAX_TEXT_LENGTH = 500
export const MAX_OPTION_LENGTH = 200
export const MAX_EXPLANATION_LENGTH = 500

// Messages name the rule, never the received value: the value is model output.
function boundedText(maxLength: number) {
  return z
    .string({ error: 'must be a string' })
    .max(maxLength, { error: `must be at most ${maxLength} characters` })
    .refine(value => value.trim() !== '', { error: 'must not be empty' })
}

const questionSchema = z.strictObject({
  text: boundedText(MAX_TEXT_LENGTH),
  options: z
    .array(boundedText(MAX_OPTION_LENGTH), { error: 'must be an array' })
    .length(OPTION_COUNT, { error: `must contain exactly ${OPTION_COUNT} options` })
    .superRefine((options, ctx) => {
      // Two equal options would make "exactly one correct option" meaningless.
      const seen = new Set<string>()
      options.forEach((option, index) => {
        const key = option.trim().toLowerCase()
        if (seen.has(key)) {
          ctx.addIssue({ code: 'custom', path: [index], message: 'options must be distinct' })
        }
        seen.add(key)
      })
    }),
  // An index into `options`, so there is exactly one correct option by construction.
  correctOption: z
    .number({ error: 'must be a number' })
    .int({ error: 'must be an integer' })
    .min(0, { error: `must be between 0 and ${OPTION_COUNT - 1}` })
    .max(OPTION_COUNT - 1, { error: `must be between 0 and ${OPTION_COUNT - 1}` }),
  explanation: boundedText(MAX_EXPLANATION_LENGTH)
}, { error: 'must be a JSON object' })

// The model output, and the `200` body of POST /api/quiz. This is the real gate: the API
// cannot enforce the counts or the index range in QUIZ_JSON_SCHEMA.
export const quizSchema = z.strictObject({
  quiz: z.strictObject({
    questions: z
      .array(questionSchema, { error: 'must be an array' })
      .length(QUESTION_COUNT, { error: `must contain exactly ${QUESTION_COUNT} questions` })
  }, { error: 'must be a JSON object' })
}, { error: 'must be a JSON object' })

export type QuizOutput = z.infer<typeof quizSchema>
export type Quiz = QuizOutput['quiz']
export type Question = Quiz['questions'][number]

// Sent as `output_config.format.schema`. Written by hand to match quizSchema, using only
// keywords structured outputs support: no array lengths, number ranges, or string lengths.
export const QUIZ_JSON_SCHEMA = {
  type: 'object',
  properties: {
    quiz: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
              correctOption: { type: 'integer', enum: [0, 1, 2, 3] },
              explanation: { type: 'string' }
            },
            required: ['text', 'options', 'correctOption', 'explanation'],
            additionalProperties: false
          }
        }
      },
      required: ['questions'],
      additionalProperties: false
    }
  },
  required: ['quiz'],
  additionalProperties: false
} as const
