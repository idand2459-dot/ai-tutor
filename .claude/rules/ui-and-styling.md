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

> Resolves Q3 of `.plan/002-2026-08-03-pixel-perfect-the-visual-design.md`: the
> former `main.css` / `setup` / `basics` / `cmps` structure predated this Tailwind
> setup and no longer applies. The token intent above is what survives from it.
