---
"@therr/tiny-code": minor
---

Add a `/priority` command to switch cost/performance bias mid-session.

`/priority` (no args) shows the current priority and the active model;
`/priority performance | balanced | cost` switches it and re-picks the
auto-selected model on the fly — e.g. jump to the most capable model when a task
gets hard, then drop back to `balanced`. Pinned models and local-first routing
keep governing the model themselves, so there the command just records the new
priority. Backed by a new `AgentLoop.setProvider` for swapping the active
provider mid-session, and a `modelPinned` flag on the resolved config.
