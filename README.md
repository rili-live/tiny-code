# tiny-code

A small, extensible CLI coding agent built around one constraint: **keep token
usage low**. As coding-agent costs climb, tiny-code automates the savings so
you don't have to. Interactive terminal REPL, interchangeable **Anthropic**,
**Gemini**, **OpenAI**, **DeepSeek**, **Qwen Coder**, and **local (Ollama)** models,
and just the core features you actually use: read/write/edit files, run shell commands,
search code, and a custom commands/skills system. No business logic baked in.

Run cheap, open-weight models locally and **escalate heavy work to a frontier
model only when needed** — see [Local models & cost-aware routing](#local-models--cost-aware-routing).

> Status: early (v0.x). Published as `@therr/tiny-code`; the binary is
> `tiny-code`. APIs and config may still change between minor versions.

## Install

```bash
npm install -g @therr/tiny-code
```

Or run from source:

```bash
npm install
npm run build
node dist/cli.js
```

## Setup

Provide at least one API key. If several are set, the default is the first
available in this order: Anthropic, Gemini, OpenAI, DeepSeek, Qwen.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=...
export OPENAI_API_KEY=sk-...
export DEEPSEEK_API_KEY=sk-...
export QWEN_API_KEY=sk-...        # Alibaba DashScope key (DASHSCOPE_API_KEY also works)
```

OpenAI, DeepSeek, and Qwen are hosted, OpenAI-compatible models. Override their
endpoints with `TINY_CODE_OPENAI_URL` (e.g. for Azure OpenAI), `TINY_CODE_DEEPSEEK_URL`,
or `TINY_CODE_QWEN_URL` (or `openaiBaseUrl` / `deepseekBaseUrl` / `qwenBaseUrl` in config)
— e.g. to point Qwen at the international DashScope host.

## Usage

```bash
tiny-code                       # start the REPL (uses an available key)
tiny-code --provider gemini     # force a provider
tiny-code --model claude-opus-4-8
tiny-code --provider openai --model gpt-4.1                # OpenAI (also o3, o4-mini, …)
tiny-code --provider deepseek --model deepseek-v4-pro     # DeepSeek's coding model
tiny-code --provider qwen --model qwen3-coder-plus        # Qwen Coder
tiny-code --provider ollama --model gemma3:12b   # run a local model (no API cost)
```

In the REPL: type a request, watch it work. Mutating actions (writes, edits,
shell commands) prompt for approval unless pre-approved in config.

- `/help` — list commands
- `/costs` — session token usage, estimated $ cost, and cost-saving tips
- `/clear` — clear the conversation history and start fresh
- `/models` — show known models, pricing, and the active one (see below)
- `/priority [performance|balanced|cost]` — show or switch the cost/performance priority mid-session; re-picks the auto-selected model unless one is pinned (see below)
- `/improve` — reflect on the session and propose an improvement PR (see below)
- `/<name> [args]` — run a custom command (see below)
- `/exit` — quit

## Local models & cost-aware routing

tiny-code talks to a local [Ollama](https://ollama.com) server over its
OpenAI-compatible API, so any model you've pulled is available — including
**Google Gemma 3** (`gemma3:4b`, `gemma3:12b`, `gemma3:27b`) and
`qwen2.5-coder` (the default, which tool-calls reliably).

```bash
ollama serve
ollama pull qwen2.5-coder:7b
tiny-code --provider ollama --model qwen2.5-coder:7b
```

**Mind the compute cost.** Local models are free of API charges but use your
machine's RAM/VRAM. On startup with an Ollama model, tiny-code prints how much
memory the model needs versus what's free, and warns if it likely won't fit or
if the model is too small (≤3B) to tool-call reliably. Rough guide (≈Q4):

| Model        | ~RAM needed | Good for                          |
| ------------ | ----------- | --------------------------------- |
| `gemma3:1b`  | ~1 GB       | trivial text (poor at tool calls) |
| `gemma3:4b`  | ~3 GB       | lightweight edits, search         |
| `gemma3:12b` | ~7 GB       | most coding tasks                 |
| `gemma3:27b` | ~16 GB      | stronger reasoning                |

**Local-first routing.** Set a `routing` of `local-first` with an `escalateTo`
target: every turn starts on the cheap/local model, and tiny-code escalates to
the frontier model when a turn looks heavy (refactors, debugging, multi-file
work) or when the local model gets stuck and calls the built-in `escalate` tool.
You get local speed and zero cost for the bulk of the work, and frontier power
only for the hard parts. Run `/costs` any time for usage, spend, and tips.

```json
{
  "provider": "ollama",
  "model": "qwen2.5-coder:7b",
  "routing": "local-first",
  "escalateTo": { "provider": "anthropic", "model": "claude-opus-4-8" }
}
```

## Project context

On start, the agent walks up from the working directory looking for `AGENTS.md`
(or `CLAUDE.md`) and includes it in the system prompt — put your project
conventions there.

## Custom commands (skills)

Drop markdown files with YAML frontmatter into `./.agent/commands/` (per project)
or `~/.config/tiny-code/commands/` (global):

```markdown
---
name: review
description: Review the staged diff for bugs
argument-hint: "[--strict]"
---

Review the staged git diff. Run `git diff --cached`, then report any bugs,
risky changes, or missing tests. $ARGUMENTS
```

Invoke with `/review --strict`. `$ARGUMENTS` is replaced with whatever you type
after the command (appended if the placeholder is absent).

## Configuration

Optional `tiny-code.config.json` in the project root (or
`~/.config/tiny-code/config.json`). Precedence: defaults < config file < env <
CLI flags.

```json
{
  "provider": "anthropic",
  "model": "claude-opus-4-8",
  "ollamaBaseUrl": "http://localhost:11434/v1",
  "priority": "balanced",
  "maxTokens": 16000,
  "thinking": true,
  "effort": "high",
  "maxIterations": 50,
  "routing": "off",
  "escalateTo": { "provider": "anthropic", "model": "claude-opus-4-8" },
  "allow": {
    "tools": [],
    "bash": ["npm test", "git status", "git diff"],
    "write": ["src/**"]
  }
}
```

`allow` pre-approves mutating actions so they skip the confirmation prompt:
`bash` matches command prefixes, `write` matches path globs for write/edit.

`routing: "local-first"` plus `escalateTo` enables cost-aware routing (see
[above](#local-models--cost-aware-routing)); it defaults to `local-first`
automatically whenever `escalateTo` is present. `ollamaBaseUrl` points at your
Ollama server's OpenAI-compatible endpoint; `deepseekBaseUrl` / `qwenBaseUrl`
override the DeepSeek and Qwen (DashScope) endpoints.

Approximate cloud pricing used for the `/costs` estimate lives in the model
catalog (`src/models/catalog.ts`) — edit it to match current vendor rates.

## Token efficiency

Minimizing token usage is a first-class goal — coding-agent bills grow fast,
and you shouldn't need a complex setup to control them. tiny-code automates
the savings where it can:

- **Usage visible by default.** Every assistant turn prints `↑ in  ↓ out tokens`
  with no configuration. On exit you get a session total.
- **Bounded tool output.** grep caps at 200 matches, glob at 500 files, and
  `read_file` supports `offset`/`limit` to pull only the lines you need —
  preventing runaway context growth automatically.
- **Minimal system prompt.** The built-in persona is kept short. Tool schemas
  are generated from Zod (no duplicate prose). Project context is opt-in.
- **Concise agent instructions.** The agent is explicitly told to avoid
  restating the task or narrating completed steps.
- **Effort control.** For Anthropic models, `effort` tunes the adaptive
  thinking budget. Drop it from the default `"high"` to `"medium"` or `"low"`
  for simpler, cheaper tasks:

  ```json
  { "effort": "medium" }
  ```

  Or set it per-session with `TINY_CODE_EFFORT=medium`.

**Coming:** automatic conversation compaction once histories grow long
(see `TODO.md`), which will keep input-token counts from compounding across
many turns without any user action.

## Model awareness & cost control

tiny-code ships a small, curated catalog of coding models
(`src/models/catalog.ts`) with each model's pricing, context window, and a
relative coding-aptitude score. It uses this to turn raw token counts into real
money and to pick a model that fits your cost/performance preference.

- **Dollar cost, not just tokens.** Per-turn usage and the session total show an
  estimated USD cost next to the token counts, priced from the active model's
  rate — so the bill is visible as you work, not a surprise later.
- **`/models`** lists the catalog (cheapest first) with pricing and scores,
  marks the active model, and shows the session's running cost.
- **Priority-driven selection.** When you don't pin a `model`, tiny-code picks
  one for you based on `priority`:

  | `priority`      | Picks                                                            |
  | --------------- | --------------------------------------------------------------- |
  | `balanced`      | The best capability-per-dollar among capable models (default).  |
  | `performance`   | The most capable model, ignoring price.                         |
  | `cost`          | The cheapest still-capable model.                               |

  `balanced` is the default: it ranks capable models by
  `codingScore / blendedCostPerMTok` (a model's coding aptitude per blended
  dollar, weighting input 80% / output 20%) behind a quality floor, so you get
  strong-but-sensibly-priced models without opting in.

  ```json
  { "priority": "performance" }
  ```

  Or per-session with `TINY_CODE_PRIORITY=cost`, or on the fly with the
  `/priority` command (e.g. `/priority performance` to jump to the most capable
  model when a task gets hard, then `/priority balanced` to drop back). Pinning
  `model` (config, env, or `--model`) always overrides the recommendation.

The catalog is curated and offline (tiny-code has no live model-discovery yet —
see `TODO.md`), so its prices carry an "as of" date; keep it current as vendors
ship new models and change pricing.

## Self-improvement

tiny-code can learn from how it's used. When a session ends (or when you run
`/improve`), it reflects on the conversation transcript looking for recurring
friction — tool errors, repeated retries, denied permissions, missing
capabilities. If it finds a concrete improvement, it asks for your permission to
open a pull request.

That PR contains **only a single markdown file** under `improvements/`
describing the proposed change, targeting `main` for a maintainer to review and
implement separately. **It never contains code changes** — this is enforced
structurally (the PR creator only ever stages one regex-validated markdown path),
so a prompt-injected session cannot smuggle code into a PR.

PRs are opened via the [`gh` CLI](https://cli.github.com/), which must be
installed and authenticated (`gh auth login`); the working tree must be clean.

```json
{
  "improve": {
    "enabled": true,
    "baseBranch": "main",
    "onSessionEnd": true
  }
}
```

The feature is **on by default**. Set `improve.enabled` to `false` (or export
`TINY_CODE_IMPROVE=0`) to disable it entirely; set `onSessionEnd` to `false` to
keep `/improve` but skip the automatic reflection at exit.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

See `TODO.md` for the deferred-features backlog (sub-agents, web search, MCP,
rich TUI, one-shot mode, conversation persistence).

## Contributing

Contributions are accepted from authorized contributors only, and are governed
by the [License](#license) — by submitting a contribution you agree to those
terms (including the assignment of rights in clause 4). This is **not** an
open-source project: please do not fork, mirror, or redistribute the codebase
(see the License).

Workflow for an authorized change:

1. Open an issue first to discuss the change and get sign-off from a maintainer.
2. Branch from `main`, keep changes focused, and follow the existing code style.
3. Before opening a PR, make sure the full check suite passes:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```

4. Add or update tests for any behavior change, and add a changeset
   (`npx changeset`) when the change is user-facing.
5. Open a PR targeting `main` for maintainer review.

### Self-improvement workflow

tiny-code can also propose its own improvements — a low-friction way to feed
ideas back to maintainers without writing code. When a session ends (or when you
run `/improve`), the agent reflects on the transcript for recurring friction
(tool errors, repeated retries, denied permissions, missing capabilities) and,
if it finds something concrete, asks permission to open a PR.

That PR contains **only a single markdown file** under `improvements/`
describing the proposed change — never code. This is enforced structurally (the
PR creator only ever stages one regex-validated markdown path), so a
prompt-injected session cannot smuggle code into a PR. A maintainer then reviews
the proposal and implements it separately. See
[Self-improvement](#self-improvement) above for configuration.

## License

**Proprietary — All Rights Reserved.** See [`LICENSE`](./LICENSE).

You are granted a limited, revocable license to **install and use** tiny-code
(e.g. via `npm install`) for your own internal or personal use. You may **not**
fork, copy, modify, redistribute, resell, or offer it as a hosted service. It is
free during the beta period; future versions may be offered under subscription
or other paid terms.
