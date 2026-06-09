import { describe, it, expect } from 'vitest';
import { classifyTurn } from '../../src/agent/router.js';

describe('classifyTurn', () => {
  it('treats simple lookups and small edits as light', () => {
    expect(classifyTurn('list the files in src')).toBe('light');
    expect(classifyTurn('what does this function return?')).toBe('light');
    expect(classifyTurn('rename foo to bar in utils.ts')).toBe('light');
  });

  it('flags strong reasoning-heavy keywords as heavy', () => {
    expect(classifyTurn('refactor the provider layer')).toBe('heavy');
    expect(classifyTurn('migrate the build to esbuild')).toBe('heavy');
    expect(classifyTurn('design a caching architecture')).toBe('heavy');
    expect(classifyTurn('find the root cause of the hang')).toBe('heavy');
  });

  it('keeps routine uses of ambiguous verbs light', () => {
    expect(classifyTurn('implement a getter for name')).toBe('light');
    expect(classifyTurn('debug this typo')).toBe('light');
    expect(classifyTurn('optimize the inner loop')).toBe('light');
  });

  it('escalates ambiguous verbs only when paired with a scope cue', () => {
    expect(classifyTurn('implement the auth system from scratch')).toBe('heavy');
    expect(classifyTurn('optimize rendering across the whole pipeline')).toBe('heavy');
  });

  it('flags multi-file and long requests as heavy', () => {
    expect(classifyTurn('update a.ts, b.ts, and c.ts to match')).toBe('heavy');
    expect(classifyTurn('x'.repeat(700))).toBe('heavy');
  });
});
