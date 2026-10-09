# Prioritized Backlog

Format:
- `- [ ] <title>`
- `- [ ] <title> | figma:<url>`   optional design reference
- `- [ ] <title> | stack:full`    opts the task into the backend stage


Current queue:
- [x] tutor message length: replies up to 4,096 tokens can exceed the 8,000-char message cap, so the next /api/chat or /api/quiz request fails with 400 | stack:full
- [x] quiz options: render inline code; options show raw backticks while the question and the explanation render it
- [x] quiz retake: focus is lost after "Retake quiz"
- [x] frontend cleanup: showFailureToast is duplicated in use-chat.ts and use-quiz.ts
- [x] backend cleanup: the role-alternation check is duplicated in quiz-request.ts and chat-request.ts | stack:full
- [x] default model: choose haiku or sonnet as the default based on quiz quality | stack:full
- [ ] agent docs cleanup: stale lines in the agent and skill files (plan 004, Q6). They describe a frontend-only app with a mock data layer and an `.orchestrate/api-contract.yaml` contract, but `backend/` exists, `frontend/src/mock/` does not, and the contract lives only in `.doc/architecture.md`: `.claude/agents/frontend.md:23` (mock data layer, "there is no backend"), `.claude/agents/frontend.md:31`, `:50-56`, `:84` (write `.orchestrate/api-contract.yaml` for a "future backend"), `.claude/agents/backend.md:27`, `:33` (read `.orchestrate/api-contract.yaml`), `.claude/agents/qa.md:25-27` (frontend-only app with a mock data layer), `.claude/agents/qa.md:35` (`.orchestrate/api-contract.yaml`), `.claude/agents/orchestrator.md:56-58` (frontend-only with a mock data layer), `.claude/skills/writing-plans/SKILL.md:42-44` (frontend-only with a mock data layer). Also review `.claude/skills/writing-tests/SKILL.md:19-20` (auth, org boundaries, persistence, migrations; this app has none). `.claude/agents/qa.md:20` (`frontend/e2e/**`) mirrors the boundary hook, so it changes only together with `.claude/hooks/enforce-agent-boundaries.js`
- [ ] model output: the models sometimes glue words together (for example "aknown", "loopto"), mostly in quiz explanations; see Known limitations in `.doc/architecture.md`. Not caused by the app; decide whether to accept it or handle it



## DONE
- [x] Setup
- [x] chat backend: proxy with streaming and system prompt | stack:full
- [x] chat UI: message list, streaming display, loading and error states
- [x] quiz generation: button, schema validation, quiz view | stack:full


