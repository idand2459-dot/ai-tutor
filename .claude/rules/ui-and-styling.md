# UI and Styling

## Libraries
- `sonner` for toast messages — keep them concise and action-oriented.
- `lucide-react` for icons — reuse the same icon name for the same concept
  across features.

## Styling engine
`frontend/` is styled with **Tailwind CSS v4** (via `@tailwindcss/postcss`),
with a single `globals.css`. Use utility classes. Do not add new `.css` files
and do not use inline styles.

## Design tokens
- Prefer CSS variables for colors, spacing, sizing, and other shared tokens.
- Declare tokens in `:root` in `globals.css` and expose them to utilities via
  `@theme inline`.
- Use nested CSS only where it improves scoping and readability.

## Chat UI
- Render `message` content as Markdown, with code in fenced, syntax-highlighted blocks.
- Treat `tutor` output as untrusted text. Never pass it to `dangerouslySetInnerHTML`.
- While the `tutor` is streaming, show a loading state and disable sending a new `message`.
- On an API failure, show a `sonner` toast and keep the `chat` and the typed input intact.
