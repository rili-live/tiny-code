/**
 * Security-critical filename derivation for improvement proposals.
 *
 * The PR creator only ever writes/stages a path built from this slug, so the
 * slug pattern is the single source of truth that keeps an (possibly injected)
 * model from influencing anything beyond a single markdown file's contents.
 */

/** A slug is lowercase alphanumerics joined by single dashes — no `/`, no `.`. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAX_BASE_LENGTH = 50;

/**
 * Turn an arbitrary title into a safe, unique slug guaranteed to match
 * {@link SLUG_RE}. Falls back to `improvement-<ts>` when the title yields
 * nothing usable (e.g. all punctuation).
 */
export function slugify(title: string): string {
  const suffix = Date.now().toString(36);

  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/^-+|-+$/g, '');

  const slug = base.length > 0 ? `${base}-${suffix}` : `improvement-${suffix}`;

  // The construction above should always satisfy SLUG_RE, but assert rather
  // than trust it — this value becomes a filename and a branch name.
  return SLUG_RE.test(slug) ? slug : `improvement-${suffix}`;
}
