# @therr/tiny-code

## 0.3.0

### Minor Changes

- 118faa0: Default model selection to `balanced` priority.

  When no `model` is pinned, tiny-code now defaults to `priority: "balanced"`
  instead of `performance`, picking the best capability-per-dollar model
  (`codingScore / blendedCostPerMTok`, behind a quality floor) rather than the
  most capable regardless of price. In line with the project's token-minimalism
  goal, this makes the out-of-the-box pick cost-aware — e.g. Claude Sonnet rather
  than Opus for Anthropic. Set `priority: "performance"` (or
  `TINY_CODE_PRIORITY=performance`) to restore the previous most-capable defaults;
  pinning a `model` still overrides everything.

- 785b832: Add local models and cost-aware, local-first routing.
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
    usage line distinguishes an unpriced _cloud_ turn ("cost unknown") from a
    _local_ turn ("no API cost").

- f5c3832: Add a `/priority` command to switch cost/performance bias mid-session.

  `/priority` (no args) shows the current priority and the active model;
  `/priority performance | balanced | cost` switches it and re-picks the
  auto-selected model on the fly — e.g. jump to the most capable model when a task
  gets hard, then drop back to `balanced`. Pinned models and local-first routing
  keep governing the model themselves, so there the command just records the new
  priority. Backed by a new `AgentLoop.setProvider` for swapping the active
  provider mid-session, and a `modelPinned` flag on the resolved config.

- 52b179d: Add DeepSeek and Qwen Coder model support.
  - **DeepSeek and Qwen providers.** Two new hosted, OpenAI-compatible providers
    (`--provider deepseek` / `--provider qwen`), keyed by `DEEPSEEK_API_KEY` and
    `QWEN_API_KEY` (or `DASHSCOPE_API_KEY`). Endpoints are overridable via
    `TINY_CODE_DEEPSEEK_URL` / `TINY_CODE_QWEN_URL` or `deepseekBaseUrl` /
    `qwenBaseUrl` in config — e.g. to target the international DashScope host.
  - **Shared OpenAI-compatible core.** The streaming/tool-call adapter that backed
    the Ollama provider is now a reusable `OpenAiCompatibleProvider` base; Ollama,
    DeepSeek, and Qwen all extend it, differing only in endpoint, auth, and error
    wording.
  - **Catalog entries** for `deepseek-v4-pro`, `deepseek-v4-flash`,
    `qwen3-coder-plus`, and `qwen3-coder-flash`, so `/costs` estimates and
    priority-based model selection work for the new providers. `/costs` treats both
    as paid cloud providers.
