import { describe, expect, it } from "vitest"
import { toastTextFor } from "@/lib/chat-error"
import { quizToastTextFor } from "@/lib/quiz-error"

describe("quizToastTextFor", () => {
  it.each([
    ["validation_error", "This chat can't be turned into a quiz. Reload the page to start a new chat."],
    ["upstream_rate_limited", "The tutor is busy. Wait a moment, then generate the quiz again."],
    ["proxy_misconfigured", "The proxy isn't set up correctly. Check the backend API key and model."],
    ["upstream_unavailable", "The tutor is unreachable right now. Generate the quiz again in a moment."],
    ["tutor_refused", "The tutor declined to build a quiz from this chat."],
    ["quiz_malformed", "The tutor couldn't build a valid quiz. Generate it again."],
    ["internal_error", "The proxy hit an unexpected error. Generate the quiz again."],
    ["network_error", "Can't reach the proxy. Is the backend running on port 4000?"],
  ])("returns the table text for %s", (code, text) => {
    expect(quizToastTextFor(code)).toBe(text)
  })

  it("returns the internal_error text for an unknown code", () => {
    expect(quizToastTextFor("brand_new_code")).toBe("The proxy hit an unexpected error. Generate the quiz again.")
  })

  it("returns the internal_error text for a name inherited from Object", () => {
    expect(quizToastTextFor("toString")).toBe("The proxy hit an unexpected error. Generate the quiz again.")
  })
})

describe("toastTextFor and quiz_malformed", () => {
  it("keeps the chat fallback text for quiz_malformed, which a chat request never gets", () => {
    expect(toastTextFor("quiz_malformed")).toBe("The proxy hit an unexpected error. Send again.")
  })
})
