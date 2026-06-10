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

## Model catalog (`src/models/catalog.ts`)
- A curated, offline list of coding models with pricing, context window, and a
  relative coding score. It drives USD cost estimates and priority-based model
  selection (`performance` / `cost` / `balanced`).
- Keep it current: when adding/repricing a model, update its entry **and**
  `CATALOG_AS_OF`. Anthropic pricing comes from the bundled claude-api reference;
  verify Gemini pricing against Google's published rates. Don't guess prices.
- `priority` defaults to `balanced` (best capability-per-dollar behind a quality
  floor), so the auto-picked model is cost-aware by default — e.g. Sonnet rather
  than Opus for Anthropic. `performance` restores the historical most-capable
  picks. Don't change the default without updating the config/catalog tests that
  assert those ids.

## Boundaries
- No business logic. This is a general-purpose tool.
- Don't add a second state paradigm or heavy dependencies without a clear reason.
- New deferred features go in `TODO.md` with a rationale and rough approach.

## Self-improvement (`src/improve/`)
- Proposals are markdown-only PRs (`improvements/<slug>.md`). The "never code"
  guarantee is structural — the PR creator validates the slug, writes one file,
  and stages exactly one explicit path (never `git add -A`). Preserve this; do
  not loosen `src/improve/pr.ts` to stage arbitrary paths.
- Reflection (`src/improve/reflect.ts`) must call the provider with `tools: []`
  so it can never execute anything from a transcript.
- Opening PRs shells out to the `gh` CLI (assumed installed + authenticated).
