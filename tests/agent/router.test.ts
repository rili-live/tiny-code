import { describe, it, expect } from 'vitest';
import { classifyTurn } from '../../src/agent/router.js';

describe('classifyTurn', () => {
  it('treats simple lookups and small edits as light', () => {
    expect(classifyTurn('list the files in src')).toBe('light');
    expect(classifyTurn('what does this function return?')).toBe('light');
    expect(classifyTurn('rename foo to bar in utils.ts')).toBe('light');
  });

  it('flags reasoning-heavy keywords as heavy', () => {
    expect(classifyTurn('refactor the provider layer')).toBe('heavy');
    expect(classifyTurn('debug why the stream hangs')).toBe('heavy');
    expect(classifyTurn('design a caching architecture')).toBe('heavy');
    expect(classifyTurn('implement retthrough retries')).toBe('heavy');
  });

  it('flags multi-file and long requests as heavy', () => {
    expect(classifyTurn('update a.ts, b.ts, and c.ts to match')).toBe('heavy');
    expect(classifyTurn('x'.repeat(700))).toBe('heavy');
  });
});
