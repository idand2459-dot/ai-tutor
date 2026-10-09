import { afterEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { ChatError, toastTextFor } from "@/lib/chat-error"
import { showFailureToast } from "@/lib/failure-toast"
import { quizToastTextFor } from "@/lib/quiz-error"

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

const toastErrorMock = vi.mocked(toast.error)

describe("showFailureToast", () => {
  afterEach(() => {
    toastErrorMock.mockReset()
  })

  it("shows the table text and the request id for a ChatError with a request id", () => {
    showFailureToast(new ChatError("upstream_rate_limited", "req-123"), toastTextFor)

    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith(
      "The tutor is busy. Wait a moment, then send again.",
      { description: "Request ID: req-123" },
    )
  })

  it("shows no description for a ChatError without a request id", () => {
    showFailureToast(new ChatError("network_error"), toastTextFor)

    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Can't reach the proxy. Is the backend running on port 4000?",
      undefined,
    )
  })

  it("shows the internal_error text and no description for a plain Error", () => {
    showFailureToast(new Error("boom"), toastTextFor)

    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith("The proxy hit an unexpected error. Send again.", undefined)
  })

  it("uses the text table it is given", () => {
    showFailureToast(new ChatError("quiz_malformed", "req-456"), quizToastTextFor)

    expect(toastErrorMock).toHaveBeenCalledWith(
      "The tutor couldn't build a valid quiz. Generate it again.",
      { description: "Request ID: req-456" },
    )
  })

  it("never puts the error message in the toast", () => {
    showFailureToast(new Error("secret message content"), toastTextFor)

    const [title, options] = toastErrorMock.mock.calls[0]
    expect(JSON.stringify([title, options])).not.toContain("secret message content")
  })
})
