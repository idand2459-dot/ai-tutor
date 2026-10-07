---
name: error-handling
description: Design or review how errors are detected, classified, logged, and returned. Use when adding an API error response, choosing an HTTP status code, shaping an error payload, writing retry logic, adding error logging, or surfacing a failure in the UI. Covers the standard error shape, status-code table, logging redaction, retry policy, and required failure-path tests.
---

# Error Handling

## Principles
- Fail fast on invalid input.
- Return safe, actionable messages to clients.
- Keep internal details in logs, never in external responses.
- Use one consistent error shape and status-code convention everywhere.

## Categories
| Category | What it means |
|---|---|
| Validation | Input missing, malformed, or out of range |
| Domain | Business rule violated (e.g. invalid state transition) |
| Infrastructure | Network, database, queue, or third-party failure |
| Auth | Missing credentials, invalid token, insufficient org/resource access |

## API response shape
Use this shape for every non-2xx response:

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "human-readable summary",
    "details": {}
  },
  "requestId": "correlation-id"
}
```

`error.details` is optional structured context, mainly for validation issues.

Never include secrets, stack traces, SQL text, or raw provider payloads in a response.

## Status codes
| Code | Use for |
|---|---|
| `400` | Malformed input |
| `401` | Unauthenticated |
| `403` | Authenticated but unauthorized |
| `404` | Missing resource |
| `409` | State conflict |
| `422` | Semantic validation failure |
| `429` | Throttling / rate limiting |
| `500` | Unexpected internal error |
| `502` / `503` | Upstream dependency unavailable |

## Logging
- Log every unexpected error with enough context to debug it.
- Include `requestId`, `org`, the operation name, and relevant identifiers.
- Redact tokens, passwords, credentials, and secrets.
- Use structured logs wherever possible.

## Retry and recovery
- Retry **only** transient infrastructure errors.
- Bounded retries with backoff — never an unbounded loop.
- Never retry validation or domain errors.
- Make retried operations idempotent where possible.

## Frontend and UX
- Show user-safe, specific messages. Avoid a bare "Something went wrong" when
  the failed action is known.
- Offer a recovery hint: retry, refresh, re-authenticate.
- Use `sonner` for toasts, per the UI and styling rule.

## Tests
Critical flows need tests for their failure modes: validation errors,
authorization failures, and dependency failures. Assert the response shape,
not just the status code.
