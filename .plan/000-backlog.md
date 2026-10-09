# Prioritized Backlog

Format:
- `- [ ] <title>`
- `- [ ] <title> | figma:<url>`   optional design reference
- `- [ ] <title> | stack:full`    opts the task into the backend stage


Current queue:
- [ ] tutor message length: replies up to 4,096 tokens can exceed the 8,000-char message cap, so the next /api/chat or /api/quiz request fails with 400
- [ ] quiz options: render inline code; options show raw backticks while the question and the explanation render it
- [ ] quiz retake: focus is lost after "Retake quiz"
- [ ] frontend cleanup: showFailureToast is duplicated in use-chat.ts and use-quiz.ts
- [ ] backend cleanup: the role-alternation check is duplicated in quiz-request.ts and chat-request.ts
- [ ] default model: choose haiku or sonnet as the default based on quiz quality



## DONE
- [x] Setup
- [x] chat backend: proxy with streaming and system prompt | stack:full
- [x] chat UI: message list, streaming display, loading and error states
- [x] quiz generation: button, schema validation, quiz view | stack:full


