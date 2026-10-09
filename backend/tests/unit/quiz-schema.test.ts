import { describe, expect, it } from 'vitest'
import {
  MAX_EXPLANATION_LENGTH,
  MAX_OPTION_LENGTH,
  MAX_TEXT_LENGTH,
  QUIZ_JSON_SCHEMA,
  quizSchema,
  type Question
} from '../../src/lib/quiz-schema.js'

function question(index: number, overrides: Record<string, unknown> = {}): Question {
  return {
    text: `Question ${index}: what ends a loop?`,
    options: ['A false condition', 'A true condition', 'A comment', 'A semicolon'],
    correctOption: 0,
    explanation: 'The loop stops when its condition becomes false.',
    ...overrides
  } as Question
}

function quiz(questions: unknown[] = [0, 1, 2, 3, 4].map(index => question(index))) {
  return { quiz: { questions } }
}

// A valid quiz whose first question has `overrides` applied.
function quizWithFirstQuestion(overrides: Record<string, unknown>) {
  return quiz([question(0, overrides), ...[1, 2, 3, 4].map(index => question(index))])
}

function accepts(value: unknown) {
  return quizSchema.safeParse(value).success
}

describe('quizSchema', () => {
  it('accepts a valid quiz of 5 questions with 4 options each', () => {
    const value = quiz()

    const result = quizSchema.safeParse(value)

    expect(result).toEqual({ success: true, data: value })
  })

  describe('counts', () => {
    it.each([4, 6])('rejects a quiz with %i questions', count => {
      const questions = Array.from({ length: count }, (_, index) => question(index))

      expect(accepts(quiz(questions))).toBe(false)
    })

    it.each([3, 5])('rejects a question with %i options', count => {
      const options = Array.from({ length: count }, (_, index) => `Option ${index}`)

      expect(accepts(quizWithFirstQuestion({ options }))).toBe(false)
    })
  })

  describe('correctOption', () => {
    it.each([0, 3])('accepts %s', correctOption => {
      expect(accepts(quizWithFirstQuestion({ correctOption }))).toBe(true)
    })

    it.each([-1, 4, 1.5, '2'])('rejects %s', correctOption => {
      expect(accepts(quizWithFirstQuestion({ correctOption }))).toBe(false)
    })
  })

  describe('text fields', () => {
    it.each(['', '   \n'])('rejects empty or whitespace text %j', text => {
      expect(accepts(quizWithFirstQuestion({ text }))).toBe(false)
    })

    it.each(['', '   \n'])('rejects an empty or whitespace option %j', option => {
      const options = [option, 'B', 'C', 'D']

      expect(accepts(quizWithFirstQuestion({ options }))).toBe(false)
    })

    it.each(['', '   \n'])('rejects an empty or whitespace explanation %j', explanation => {
      expect(accepts(quizWithFirstQuestion({ explanation }))).toBe(false)
    })

    it(`accepts text of exactly ${MAX_TEXT_LENGTH} characters and rejects one more`, () => {
      expect(accepts(quizWithFirstQuestion({ text: 'x'.repeat(MAX_TEXT_LENGTH) }))).toBe(true)
      expect(accepts(quizWithFirstQuestion({ text: 'x'.repeat(MAX_TEXT_LENGTH + 1) }))).toBe(false)
    })

    it(`accepts an option of exactly ${MAX_OPTION_LENGTH} characters and rejects one more`, () => {
      const options = (first: string) => [first, 'B', 'C', 'D']

      expect(accepts(quizWithFirstQuestion({ options: options('x'.repeat(MAX_OPTION_LENGTH)) }))).toBe(true)
      expect(accepts(quizWithFirstQuestion({ options: options('x'.repeat(MAX_OPTION_LENGTH + 1)) }))).toBe(false)
    })

    it(`accepts an explanation of exactly ${MAX_EXPLANATION_LENGTH} characters and rejects one more`, () => {
      expect(accepts(quizWithFirstQuestion({ explanation: 'x'.repeat(MAX_EXPLANATION_LENGTH) }))).toBe(true)
      expect(accepts(quizWithFirstQuestion({ explanation: 'x'.repeat(MAX_EXPLANATION_LENGTH + 1) }))).toBe(false)
    })
  })

  it('rejects two options that are equal after trimming and lowercasing', () => {
    const options = ['A loop', 'B', ' a LOOP ', 'D']

    expect(accepts(quizWithFirstQuestion({ options }))).toBe(false)
  })

  describe('shape', () => {
    it('rejects an extra field on the root', () => {
      expect(accepts({ ...quiz(), extra: true })).toBe(false)
    })

    it('rejects an extra field on the quiz', () => {
      const value = quiz()

      expect(accepts({ quiz: { ...value.quiz, extra: true } })).toBe(false)
    })

    it('rejects an extra field on a question', () => {
      expect(accepts(quizWithFirstQuestion({ extra: true }))).toBe(false)
    })

    it('rejects a question with no explanation', () => {
      const { explanation: _explanation, ...withoutExplanation } = question(0)

      expect(accepts(quiz([withoutExplanation, ...[1, 2, 3, 4].map(index => question(index))]))).toBe(false)
    })
  })
})

// Every node in the JSON schema, depth first.
function schemaNodes(node: unknown): Record<string, unknown>[] {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    return []
  }
  const record = node as Record<string, unknown>
  const children = Object.values(record).flatMap(value =>
    Array.isArray(value) ? value.flatMap(schemaNodes) : schemaNodes(value)
  )
  return [record, ...children]
}

describe('QUIZ_JSON_SCHEMA', () => {
  const objects = schemaNodes(QUIZ_JSON_SCHEMA).filter(node => node.type === 'object')

  it('has the three object levels: root, quiz, and question', () => {
    expect(objects).toHaveLength(3)
  })

  it('sets additionalProperties: false and requires every property on every object', () => {
    for (const node of objects) {
      expect(node.additionalProperties).toBe(false)
      expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort())
    }
  })

  it('uses no keyword that structured outputs does not support', () => {
    const unsupported = ['minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'maxLength']

    for (const node of schemaNodes(QUIZ_JSON_SCHEMA)) {
      for (const keyword of unsupported) {
        expect(node).not.toHaveProperty(keyword)
      }
    }
  })

  it('limits correctOption to the four option indexes', () => {
    const question = QUIZ_JSON_SCHEMA.properties.quiz.properties.questions.items

    expect(question.properties.correctOption).toEqual({ type: 'integer', enum: [0, 1, 2, 3] })
  })
})
