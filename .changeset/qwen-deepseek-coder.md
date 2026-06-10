---
"@therr/tiny-code": minor
---

Add DeepSeek and Qwen Coder model support.

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
