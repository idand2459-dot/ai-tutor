import { z } from 'zod'

export const DEFAULT_MODEL = 'claude-haiku-4-5'
export const DEFAULT_PORT = 4000

export type Config = {
  anthropicApiKey: string
  frontendUrl: string
  port: number
  model: string
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

// Unset and blank values are treated the same, so `ANTHROPIC_MODEL=` in .env means "use the default".
const optional = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional()
)

// Custom messages only: a default zod message could echo the received value, and one of them is the API key.
const envSchema = z.object({
  ANTHROPIC_API_KEY: optional.refine(value => value !== undefined, 'is required'),
  FRONTEND_URL: optional
    .refine(value => value !== undefined, 'is required')
    .refine(value => value === undefined || URL.canParse(value), 'must be a valid URL'),
  PORT: optional.refine(
    value => value === undefined || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535),
    'must be an integer between 1 and 65535'
  ),
  ANTHROPIC_MODEL: optional
})

// Reads and validates the environment once at startup. Throws ConfigError listing every
// problem by variable name; never includes a value in the message.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env)

  if (!result.success) {
    const problems = result.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`)
    throw new ConfigError(`Invalid backend configuration: ${problems.join('; ')}`)
  }

  const { ANTHROPIC_API_KEY, FRONTEND_URL, PORT, ANTHROPIC_MODEL } = result.data

  return {
    anthropicApiKey: ANTHROPIC_API_KEY as string,
    // CORS compares origins exactly, so drop any path or trailing slash.
    frontendUrl: new URL(FRONTEND_URL as string).origin,
    port: PORT === undefined ? DEFAULT_PORT : Number(PORT),
    model: ANTHROPIC_MODEL ?? DEFAULT_MODEL
  }
}
