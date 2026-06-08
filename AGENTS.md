# Project Instructions for tiny-code

This file is loaded into the agent's system prompt when it runs in this repo.

## Conventions
- TypeScript, ESM, strict mode. Keep the agent loop provider- and UI-agnostic.
- One source of truth for tool schemas: define them with zod via `defineTool`.
- Add unit tests for new tools, providers, and loop behavior (Vitest).
- Run `npm run lint && npm run typecheck && npm test` before considering a change done.

## Token minimalism
Keeping token counts low is a core design concern, not an afterthought. Savings
should be automatic — the user should not need custom configuration to avoid
runaway costs.

- Keep the system prompt short. Tool descriptions are generated from Zod schemas;
  don't add redundant prose.
- Tool output must be bounded. Always cap result sets (grep matches, glob hits,
  file lines). Prefer targeted reads over full-file slurps.
- Surface usage automatically. Token counts appear after every turn and as a
  session total on exit; no opt-in required.
- Prefer features that reduce tokens structurally (output caps, compaction) over
  features that merely expose knobs for users to tune manually.

## Boundaries
- No business logic. This is a general-purpose tool.
- Don't add a second state paradigm or heavy dependencies without a clear reason.
- New deferred features go in `TODO.md` with a rationale and rough approach.
