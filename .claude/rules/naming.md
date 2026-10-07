# Naming

Applies to API routes, domain entities, services, files, types, and data fields.

- Prefer **singular** entity names: `quiz.service`, `/api/quiz`, `/api/chat`. Collections (arrays, lists) may be plural: `options`, `questions`.
- Use the canonical term from `.doc/glossary.md`, never a synonym. Define any new shared term there before using it.
- Multi-word terms: camelCase in code and JSON (`correctOption`), PascalCase for types (`SystemPrompt`), kebab-case for filenames (`system-prompt.ts`).
- Keep route and file names aligned with the domain name they serve.
