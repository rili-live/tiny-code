# tiny-code

A small, extensible CLI coding agent. Interactive terminal REPL, interchangeable
**Anthropic**, **Gemini**, and **local (Ollama)** models, and just the core
features you actually use: read/write/edit files, run shell commands, search
code, and a custom commands/skills system. No business logic baked in.

Run cheap, open-weight models locally and **escalate heavy work to a frontier
model only when needed** — see [Local models & cost-aware routing](#local-models--cost-aware-routing).

> Status: early (v0.x). Published as `@therr/tiny-code`; the binary is
> `tiny-code`. Names may change before the first npm publish.

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

Provide at least one API key. If both are set, Anthropic is used by default.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=...
```

## Usage

```bash
tiny-code                       # start the REPL (uses an available key)
tiny-code --provider gemini     # force a provider
tiny-code --model claude-opus-4-8
tiny-code --provider ollama --model gemma3:12b   # run a local model (no API cost)
```

In the REPL: type a request, watch it work. Mutating actions (writes, edits,
shell commands) prompt for approval unless pre-approved in config.

- `/help` — list commands
- `/costs` — session token usage, estimated $ cost, and cost-saving tips
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
Ollama server's OpenAI-compatible endpoint.

Approximate cloud pricing used for the `/costs` estimate lives in
`src/providers/pricing.ts` — edit it to match current vendor rates.

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

## License

MIT
