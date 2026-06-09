/**
 * Lightweight, dependency-free task classification for local-first routing.
 *
 * The cheap/local model handles each turn by default; this heuristic flags the
 * turns that are better started on the frontier model. It is intentionally
 * conservative — when in doubt it returns 'light' and lets the local model
 * escalate explicitly (via the `escalate` tool) if it gets stuck.
 */
export type TaskWeight = 'light' | 'heavy';

/**
 * Strong, unambiguous signals that a turn genuinely needs the frontier model.
 * These rarely show up in routine one-line requests.
 */
const HEAVY_PATTERNS: RegExp[] = [
  /\brefactor(?:ing|ed)?\b/i,
  /\barchitect(?:ure|ural)?\b/i,
  /\bmigrat(?:e|ion|ing)\b/i,
  /\bredesign\b/i,
  /\broot[- ]?cause\b/i,
  /\bthink (?:hard|carefully|through|deeply)\b/i,
  /\bacross (?:the |multiple |several )?(?:files|modules|codebase)\b/i,
  /\bend[- ]to[- ]end\b/i,
];

/**
 * Verbs that signal a heavy task only when paired with a scope/complexity cue.
 * On their own — "implement a getter", "debug this typo", "optimize the loop" —
 * they're everyday coding and stay local; eagerly escalating them would blunt
 * the local-first cost savings. The local model can still escalate itself via
 * the `escalate` tool when it actually struggles.
 */
const AMBIGUOUS_VERBS = /\b(?:implement(?:s|ing|ed)?|debug(?:ging|ged)?|optimi[sz]e|design)\b/i;
const SCOPE_CUES =
  /\b(?:entire|whole|complete(?:ly)?|across|multiple|several|system|subsystem|pipeline|codebase|module|from scratch)\b/i;

/** Number of file-path-looking tokens above which a turn is considered heavy. */
const MULTI_FILE_THRESHOLD = 3;
/** Character length above which a turn is considered heavy. */
const LONG_INPUT_CHARS = 600;

/** Classify a user turn as 'light' (local) or 'heavy' (escalate to frontier). */
export function classifyTurn(input: string): TaskWeight {
  const text = input.trim();
  if (text.length >= LONG_INPUT_CHARS) return 'heavy';
  if (HEAVY_PATTERNS.some((re) => re.test(text))) return 'heavy';

  const fileMentions = text.match(/[\w./-]+\.[a-z]{1,5}\b/gi) ?? [];
  if (fileMentions.length >= MULTI_FILE_THRESHOLD) return 'heavy';

  // Ambiguous verbs escalate only alongside a scope/complexity cue.
  if (AMBIGUOUS_VERBS.test(text) && SCOPE_CUES.test(text)) return 'heavy';

  return 'light';
}
