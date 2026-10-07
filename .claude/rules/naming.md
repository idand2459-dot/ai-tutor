# Naming

Applies to API routes, domain entities, services, files, and data fields.

- Prefer **singular** entity names: `site.service`, `/api/site`, `/api/post`.
- Use the canonical short term, never a synonym:
  - `org` — not `organization`
  - `geo` — not `geolocation` or `localization`
  - `lat` / `lng` — for coordinates
- Keep route and file names aligned with the domain name they serve.
- Do not introduce a second word for a concept that already has one. Canonical
  terms live in `.doc/glossary.md`; document a new shared term there before
  using it broadly.
