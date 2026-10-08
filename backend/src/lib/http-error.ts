import type { Response } from 'express'

// Every error code the proxy returns, per the API Contract in .doc/architecture.md.
export type ErrorCode =
  | 'validation_error'
  | 'not_found'
  | 'upstream_rate_limited'
  | 'proxy_misconfigured'
  | 'upstream_unavailable'
  | 'tutor_refused'
  | 'quiz_malformed'
  | 'internal_error'

export type ErrorBody = {
  error: {
    code: ErrorCode
    message: string
    details?: Record<string, unknown>
  }
  requestId: string
}

// The request-id middleware stores the id in res.locals.
export function getRequestId(res: Response): string {
  return String(res.locals.requestId ?? 'unknown')
}

export function errorBody(
  res: Response,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): ErrorBody {
  return {
    error: details === undefined ? { code, message } : { code, message, details },
    requestId: getRequestId(res)
  }
}

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
) {
  res.status(status).json(errorBody(res, code, message, details))
}
