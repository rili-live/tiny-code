# tiny-code

A small, extensible CLI coding agent. Interactive terminal REPL, interchangeable
**Anthropic** and **Gemini** models, and just the core features you actually use:
read/write/edit files, run shell commands, search code, and a custom
commands/skills system. No business logic baked in.

> Status: early (v0.x). The package/binary name (`tiny-code`) may change before
> the first npm publish.

## Install

```bash
npm install -g tiny-code
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
