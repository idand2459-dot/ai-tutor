import { describe, expect, it } from "vitest"
import { splitInlineCode } from "@/lib/inline-code"

describe("splitInlineCode", () => {
  it("splits one code span and keeps the spaces around it", () => {
    expect(splitInlineCode("use `map()` here")).toEqual([
      { type: "text", value: "use " },
      { type: "code", value: "map()" },
      { type: "text", value: " here" },
    ])
  })

  it("splits two code spans", () => {
    expect(splitInlineCode("`let` or `const`?")).toEqual([
      { type: "code", value: "let" },
      { type: "text", value: " or " },
      { type: "code", value: "const" },
      { type: "text", value: "?" },
    ])
  })

  it("keeps an unmatched backtick as literal text", () => {
    expect(splitInlineCode("a `b c")).toEqual([{ type: "text", value: "a `b c" }])
  })

  it("keeps an empty pair as literal text", () => {
    expect(splitInlineCode("``")).toEqual([{ type: "text", value: "``" }])
  })

  it("keeps double backticks as literal text", () => {
    expect(splitInlineCode("``a``")).toEqual([{ type: "text", value: "``a``" }])
  })

  it("returns text with no backtick as one text segment", () => {
    expect(splitInlineCode("A while loop")).toEqual([{ type: "text", value: "A while loop" }])
  })

  it("parses nothing else", () => {
    expect(splitInlineCode("a*b*c")).toEqual([{ type: "text", value: "a*b*c" }])
    expect(splitInlineCode("_x_")).toEqual([{ type: "text", value: "_x_" }])
  })
})
