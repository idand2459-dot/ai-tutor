# Product Definition

## Purpose
An AI-powered web tutor for developers that guides code problem-solving in the chat and generates interactive quizzes from the active chat.

## Product Vision
A trusted daily coding companion where beginner developers learn to solve bugs and master new syntax independently, through active AI guidance rather than copying ready-made solutions.

## Problem Statement
Standard AI coding tools instantly provide complete solutions and full code blocks. Developers copy and paste blindly, without understanding the logic or retaining the knowledge.

## Value Proposition
- **Guides instead of solving:** the tutor asks guiding questions rather than giving away the full solution, unless explicitly requested.
- **Chat-based quiz generation:** generates quizzes dynamically from the ongoing chat and the topics recently discussed.
- **Always-available assistance:** immediate, round-the-clock code explanations and troubleshooting.

## Product Scope
- In scope:
  - Interactive tutoring chat that guides users and prompts critical thinking.
  - Quiz generation triggered by a dedicated "Generate Quiz" button in the chat, derived from the recent chat history. The button is disabled while the chat is empty.
  - Thin backend proxy between the browser and the Anthropic API, keeping the API key on the server and running locally for development and testing.
- Out of scope:
  - User accounts, authentication and database persistence (progress tracking is deferred to a future version).
  - Code execution and sandbox environments.
  - Structured pre-recorded lesson modules or video content.
  - Native mobile application.
  - Public cloud deployment and multi-tenant hosting (local or protected use only, to prevent API credit abuse).

## Target Users
- Primary users: junior full-stack developers and computer science students building projects, who need active, interactive guidance to debug and learn new technologies.
- Secondary users: none in v1.

## Acceptance Criteria
Each criterion must be provable by a test.

- AC01 — Quality gates: `npx tsc --noEmit` is clean and the unit and automated test suites pass.
- AC02 — Chat streaming and loading state: when the user sends a message, a loading indicator appears immediately, and the response is rendered incrementally (at least two partial updates before completion). Verified by an automated test.
- AC03 — Error resilience: when the Anthropic API fails or the network errors, a clear user-friendly message is shown and the interface stays usable (no crash, input still works). Verified by an automated test with a mocked network failure.
- AC04 — Quiz generation and schema: when the user clicks "Generate Quiz", the system produces exactly 5 questions, each with 4 options and exactly 1 correct option. If the model returns malformed output, the system retries once; if the retry also fails, a clear error is shown. Verified by unit tests against mocked model responses (valid, malformed then valid, malformed twice).
- AC05 — Tutor system prompt enforcement: every chat request sent to the Anthropic API includes a system prompt instructing the model to guide the user with questions rather than provide the full solution, unless the user explicitly asks for it. Verified by a unit test asserting the request payload.
- AC06 — API key security: the Anthropic API key exists only in the backend environment. A search of the built client bundle finds no trace of it, and in automated tests the browser sends requests only to the local proxy, never to `api.anthropic.com`. Verified by a build-output check and automated network assertions.
- AC07 — Quiz button state: while the chat has no messages, the "Generate Quiz" button is disabled; after the first exchange it is enabled. Verified by an e2e test.
