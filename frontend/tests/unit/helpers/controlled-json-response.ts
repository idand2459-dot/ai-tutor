// A fetch result the test settles by hand. Nothing reaches the caller until the
// test calls respond() or fail(), so loading states can be checked without timers.

export type ControlledJsonResponse = {
  // Pass this to fetchMock.mockReturnValueOnce.
  promise: Promise<Response>
  respond: (status: number, body: unknown, headers?: HeadersInit) => void
  fail: (reason?: unknown) => void
}

export function createControlledJsonResponse(): ControlledJsonResponse {
  let resolve!: (response: Response) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return {
    promise,
    respond: (status, body, headers = {}) => {
      const allHeaders = new Headers(headers)
      if (!allHeaders.has("Content-Type")) {
        allHeaders.set("Content-Type", "application/json")
      }
      resolve(new Response(JSON.stringify(body), { status, headers: allHeaders }))
    },
    fail: (reason = new TypeError("Failed to fetch")) => reject(reason),
  }
}
