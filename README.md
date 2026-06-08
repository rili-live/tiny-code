# tiny-code

A small, extensible CLI coding agent built around one constraint: **keep token
usage low**. As coding-agent costs climb, tiny-code automates the savings so
you don't have to. Interactive terminal REPL, interchangeable **Anthropic** and
**Gemini** models, and just the core features you actually use: read/write/edit
files, run shell commands, search code, and a custom commands/skills system.
No business logic baked in.

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
```

In the REPL: type a request, watch it work. Mutating actions (writes, edits,
shell commands) prompt for approval unless pre-approved in config.

- `/help` — list commands
- `/<name> [args]` — run a custom command (see below)
- `/exit` — quit

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
  "maxTokens": 16000,
  "thinking": true,
  "effort": "high",
  "maxIterations": 50,
  "allow": {
    "tools": [],
    "bash": ["npm test", "git status", "git diff"],
    "write": ["src/**"]
  }
}
```

`allow` pre-approves mutating actions so they skip the confirmation prompt:
`bash` matches command prefixes, `write` matches path globs for write/edit.

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
