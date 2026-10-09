export type InlineSegment = { type: "text" | "code", value: string }

// One backtick, at least one non-backtick character, one backtick. The
// lookarounds skip runs of two or more backticks, so "``" and "``a``" stay text.
const CODE_SPAN = /(?<!`)`([^`]+)`(?!`)/g

// Splits model output into plain text and inline code. Only single-backtick
// pairs are code; nothing else is parsed, so `*`, `_`, and HTML stay literal
// text. The segments are rendered as React text, never as HTML.
export function splitInlineCode(text: string): InlineSegment[] {
  const segments: InlineSegment[] = []
  let last = 0
  for (const match of text.matchAll(CODE_SPAN)) {
    if (match.index > last) {
      segments.push({ type: "text", value: text.slice(last, match.index) })
    }
    segments.push({ type: "code", value: match[1] })
    last = match.index + match[0].length
  }
  if (last < text.length) {
    segments.push({ type: "text", value: text.slice(last) })
  }
  return segments
}
