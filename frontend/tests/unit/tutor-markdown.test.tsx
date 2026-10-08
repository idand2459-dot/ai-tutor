import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TutorMarkdown } from "@/components/chat/tutor-markdown"

function renderMarkdown(content: string) {
  return render(<TutorMarkdown content={content} />).container
}

describe("TutorMarkdown code", () => {
  it("renders a fenced code block as plain pre > code", () => {
    const container = renderMarkdown("```js\nconst x = 1\n```")

    const code = container.querySelector("pre > code")
    expect(code).not.toBeNull()
    expect(code).toHaveTextContent("const x = 1")
    expect(code?.className).toBe("language-js")
    expect(container.querySelector("[class*='hljs']")).toBeNull()
  })

  it("renders a partial reply with an unclosed code fence without throwing", () => {
    const container = renderMarkdown("Try this:\n\n```js\nfor (let i = 0; i < 10")

    expect(container.querySelector("pre > code")).toHaveTextContent("for (let i = 0; i < 10")
  })
})

describe("TutorMarkdown raw HTML", () => {
  it("does not turn a script tag into an element", () => {
    const container = renderMarkdown("Look: <script>alert(1)</script>")

    expect(container.querySelector("script")).toBeNull()
    expect(document.querySelector("script")).toBeNull()
  })

  it("does not turn an img tag with onerror into an element", () => {
    const container = renderMarkdown("Look: <img src=x onerror=alert(1)>")

    expect(container.querySelector("img")).toBeNull()
    expect(document.querySelector("img")).toBeNull()
  })

  it("shows raw HTML as literal text", () => {
    renderMarkdown("Use <br> to break a line")

    expect(screen.getByText("Use <br> to break a line")).toBeInTheDocument()
  })
})

describe("TutorMarkdown images", () => {
  it("drops an image written in Markdown syntax", () => {
    const container = renderMarkdown("Here: ![x](https://example.com/a.png)")

    expect(container.querySelector("img")).toBeNull()
    expect(container).not.toHaveTextContent("example.com")
  })
})

describe("TutorMarkdown links", () => {
  it("gives a javascript: link no javascript: href", () => {
    const container = renderMarkdown("[x](javascript:alert(1))")

    const link = container.querySelector("a")
    expect(link?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i)
  })

  it("opens a normal link in a new tab without an opener", () => {
    renderMarkdown("[MDN](https://developer.mozilla.org)")

    const link = screen.getByRole("link", { name: "MDN" })
    expect(link).toHaveAttribute("href", "https://developer.mozilla.org")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })
})

describe("TutorMarkdown formatting", () => {
  it("renders bold text as strong", () => {
    const container = renderMarkdown("This is **important**.")

    expect(container.querySelector("strong")).toHaveTextContent("important")
  })

  it("renders a list as ul > li", () => {
    const container = renderMarkdown("- first\n- second")

    expect(container.querySelectorAll("ul > li")).toHaveLength(2)
  })

  it("renders a GFM table", () => {
    const container = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")

    expect(container.querySelector("table")).not.toBeNull()
    expect(container.querySelectorAll("th")).toHaveLength(2)
    expect(container.querySelectorAll("td")).toHaveLength(2)
  })

  it("applies the typography classes", () => {
    const container = renderMarkdown("text")

    expect(container.firstElementChild).toHaveClass("prose", "dark:prose-invert", "max-w-chat")
  })
})
