import { describe, it, expect } from 'vitest';
import { SLUG_RE, slugify } from '../../src/improve/slug.js';

describe('slugify', () => {
  it('produces a SLUG_RE-valid slug from a normal title', () => {
    const slug = slugify('Improve the grep tool');
    expect(SLUG_RE.test(slug)).toBe(true);
    expect(slug).toMatch(/^improve-the-grep-tool-/);
  });

  it('strips punctuation and collapses separators', () => {
    const slug = slugify('Add  ??? web_fetch!! tool');
    expect(SLUG_RE.test(slug)).toBe(true);
    expect(slug.startsWith('-')).toBe(false);
    expect(slug).not.toContain('_');
  });

  it('neutralizes path-traversal attempts', () => {
    for (const evil of ['../../etc/passwd', '..\\..\\win', '/abs/path', 'a/b/c.md']) {
      const slug = slugify(evil);
      expect(SLUG_RE.test(slug)).toBe(true);
      expect(slug).not.toContain('/');
      expect(slug).not.toContain('.');
    }
  });

  it('falls back to improvement-<ts> when nothing usable remains', () => {
    const slug = slugify('!!!  ...');
    expect(SLUG_RE.test(slug)).toBe(true);
    expect(slug).toMatch(/^improvement-/);
  });

  it('caps the base length', () => {
    const slug = slugify('x'.repeat(200));
    // base (<=50) + '-' + timestamp suffix
    expect(slug.length).toBeLessThan(70);
    expect(SLUG_RE.test(slug)).toBe(true);
  });
});
