# Backlog

Deferred features, roughly in priority order. Each entry notes the rationale and
a rough approach so it can be picked up later.

Token efficiency is a first-class goal. Features that reduce token usage
automatically (without user configuration) are prioritized over features that
add capability at higher cost.

## Conversation compaction
Input tokens compound quickly in long sessions because the full message history
is resent every turn. Compaction trims the history automatically once it grows
past a threshold, keeping costs from ballooning without any user action.
**Approach:** track cumulative `inputTokens` from `AgentLoop.getUsage()`; when
it crosses a configurable threshold (e.g. 50k), summarize earlier messages into
a single condensed block. For Anthropic use the compaction beta; for Gemini
summarize via a lightweight call to a cheap model. Pair with conversation
persistence so compacted sessions can be resumed.

## Sub-agents
Spawn isolated agent runs for parallel exploration/research (like a lightweight
Explore/Plan agent). **Approach:** a `spawn_agent` tool whose `execute` constructs
a child `AgentLoop` with its own message history and a read-only tool subset,
returning the child's final text. Keep depth at 1 to start.

> Note: the cheap/expensive model split is now handled by **local-first
> routing** (`routing: "local-first"` + `escalateTo`): turns start on the
> local/cheap model and escalate to a frontier model when heavy or stuck (see
> `src/agent/router.ts`, `src/tools/escalate.ts`, and the loop's escalation
> logic). Sub-agents remain useful for *parallel* isolated runs.

## More local-model interoperability
Ollama is wired in via its OpenAI-compatible endpoint (`src/providers/ollama.ts`),
which already covers LM Studio and vLLM (same wire format) by pointing
`ollamaBaseUrl`/`TINY_CODE_OLLAMA_URL` at them. **Next:** an optional
`/api/tags` probe to list locally-installed models and surface tokens/sec in the
usage line; per-model context-window awareness for the RAM advisory.

## Web search / fetch
Let the agent look up docs during a task. **Approach:** add `web_search` and
`web_fetch` tools. For Anthropic, optionally delegate to the server-side
`web_search_20260209` tool instead of a client tool; for Gemini use grounding.
Start with a simple client-side `web_fetch` (HTTP GET + readability extraction).

## MCP client support
Connect external tool servers (e.g. the GitHub MCP). **Approach:** an MCP client
that lists a server's tools and adapts them into the `Tool` interface
(`jsonSchema` is already the right shape), registered alongside built-in tools.
Largest surface area — do after the above.

## Rich TUI (Ink)
Live-updating panes, spinners, key handling. **Approach:** an alternative
renderer implementing `AgentUI` backed by Ink, selected by a flag/config. The
loop is already UI-agnostic, so this is additive. Heavier and harder to unit
test than the current minimal renderer.

## One-shot / `--print` mode
Run a single prompt non-interactively for scripting/CI. **Approach:** a code path
that builds the same `AgentLoop` but feeds one prompt, streams to stdout, and
exits; permission gate falls back to allowlist-only (no prompts).

## Conversation persistence / resume
Save/restore `AgentLoop.getMessages()` to disk; `--resume` to continue a session.
Pair with the compaction feature above so resumed sessions don't carry a bloated
history.

## Live model catalog refresh
The model catalog (`src/models/catalog.ts`) is curated and offline, so its
pricing and model list drift until a human updates them. **Approach:** an opt-in
refresh that pulls current models/pricing from the provider APIs (Anthropic's
`GET /v1/models` for capabilities; a pricing source for rates) and Gemini's
equivalent, caching to disk with the `CATALOG_AS_OF` date. Gate behind a flag so
the default stays offline and deterministic. Pairs with the existing
priority-based selection — fresher data, same `recommendModel` logic.

## ripgrep-backed grep
The `grep` tool currently walks the tree in JS. **Approach:** detect `rg` on
PATH and shell out for speed + .gitignore awareness, falling back to the JS
implementation when absent.
