---
"@therr/tiny-code": minor
---

Add local models and cost-aware, local-first routing.

- **Local (Ollama) provider.** Talk to a local Ollama server over its
  OpenAI-compatible API (`--provider ollama`), with an idle timeout so a hung
  model can't freeze the REPL, best-effort token-usage reporting, and configurable
  `maxTokens`.
- **Local-first routing.** Set `routing: "local-first"` with an `escalateTo`
  target to run a cheap/local model by default and escalate heavy turns (or a
  stuck local model, via the new `escalate` tool) to a frontier model — with full
  conversation context preserved. Escalation is sticky across follow-up turns.
- **Model-selection policy** is now owned by a pluggable `ModelDecisionEngine`
  (`LocalFirstModelEngine`), keeping the agent loop pure mechanism.
- **Compute awareness.** On startup with a local model, tiny-code estimates RAM
  need vs. machine capacity and warns when a model likely won't fit or is too
  small (≤3B) to tool-call reliably; an over-RAM local model is routed to the
  frontier up front.
- **Priority-driven model selection.** `priority` (`performance` / `cost` /
  `balanced`, or `TINY_CODE_PRIORITY`) auto-picks a catalog model when none is
  pinned.
- The `/costs` view reports session usage, estimated spend, and routing, and the
  usage line distinguishes an unpriced *cloud* turn ("cost unknown") from a
  *local* turn ("no API cost").
