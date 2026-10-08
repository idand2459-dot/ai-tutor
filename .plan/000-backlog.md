# Prioritized Backlog

Format:
- `- [ ] <title>`
- `- [ ] <title> | figma:<url>`   optional design reference
- `- [ ] <title> | stack:full`    opts the task into the backend stage


Current queue:
- [ ] quiz generation: button, schema validation, quiz view | stack:full
- [ ] tutor message length: replies up to 4,096 tokens can exceed the 8,000-char message cap, so the next /api/chat or /api/quiz request fails with 400



## DONE
- [x] Setup
- [x] chat backend: proxy with streaming and system prompt | stack:full
- [x] chat UI: message list, streaming display, loading and error states


