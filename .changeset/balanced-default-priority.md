---
"@therr/tiny-code": minor
---

Default model selection to `balanced` priority.

When no `model` is pinned, tiny-code now defaults to `priority: "balanced"`
instead of `performance`, picking the best capability-per-dollar model
(`codingScore / blendedCostPerMTok`, behind a quality floor) rather than the
most capable regardless of price. In line with the project's token-minimalism
goal, this makes the out-of-the-box pick cost-aware — e.g. Claude Sonnet rather
than Opus for Anthropic. Set `priority: "performance"` (or
`TINY_CODE_PRIORITY=performance`) to restore the previous most-capable defaults;
pinning a `model` still overrides everything.
