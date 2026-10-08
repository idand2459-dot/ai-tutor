import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

// Tutor output is untrusted. react-markdown builds React elements, never an HTML
// string, and turns raw HTML into plain text unless a raw-HTML rehype plugin is
// added, which it must not be. Images are dropped so a reply can never make
// the browser call a third-party host. The default urlTransform stays, so a
// `javascript:` link gets an empty href.
const disallowedElements = ["img"]

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
}

export function TutorMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-zinc dark:prose-invert max-w-chat prose-a:text-accent">
      <Markdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={disallowedElements}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  )
}
