import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Call {
  cmd: string;
  args: string[];
}

// Shared mock state, reset per test.
const calls: Call[] = [];
let handler: (cmd: string, args: string[]) => { stdout: string; stderr: string };

vi.mock('node:child_process', () => {
  const execFile = function execFile(): void {
    /* unused — only the promisified custom path is exercised */
  };
  // promisify(execFile) returns this custom function, resolving to {stdout,stderr}.
  (execFile as unknown as Record<symbol, unknown>)[
    Symbol.for('nodejs.util.promisify.custom')
  ] = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return Promise.resolve(handler(cmd, args));
  };
  return { execFile };
});

// Imported after the mock is registered.
const { createImprovementPr } = await import('../../src/improve/pr.js');

/** A handler simulating a clean repo with an authed gh, tracking staged files. */
function happyHandler() {
  const staged: string[] = [];
  return (cmd: string, args: string[]) => {
    if (cmd === 'git' && args[0] === 'add') staged.push(args[1] ?? '');
    if (cmd === 'git' && args.includes('--cached') && args.includes('--name-only')) {
      return { stdout: staged.join('\n'), stderr: '' };
    }
    if (cmd === 'git' && args[0] === 'rev-parse' && args.includes('--abbrev-ref')) {
      return { stdout: 'work-branch', stderr: '' };
    }
    if (cmd === 'git' && args[0] === 'status') return { stdout: '', stderr: '' };
    if (cmd === 'gh' && args[0] === 'pr') {
      return { stdout: 'https://github.com/o/r/pull/7', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
}

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'tiny-code-pr-'));
  calls.length = 0;
  handler = happyHandler();
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('createImprovementPr', () => {
  it('opens a PR staging only the single markdown path', async () => {
    const result = await createImprovementPr({
      cwd,
      slug: 'better-grep-abc',
      title: 'Better grep',
      markdown: '# Better grep\n',
    });

    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://github.com/o/r/pull/7');

    const adds = calls.filter((c) => c.cmd === 'git' && c.args[0] === 'add');
    expect(adds).toHaveLength(1);
    expect(adds[0]?.args).toEqual(['add', 'improvements/better-grep-abc.md']);
  });

  it('never stages with -A or .', async () => {
    await createImprovementPr({ cwd, slug: 'x-1', title: 'X', markdown: '# X' });
    for (const c of calls) {
      if (c.cmd === 'git' && c.args[0] === 'add') {
        expect(c.args).not.toContain('-A');
        expect(c.args).not.toContain('.');
      }
    }
  });

  it('passes title to gh as a discrete argument (no shell interpolation)', async () => {
    const evil = 'X"; rm -rf / #';
    await createImprovementPr({ cwd, slug: 'x-2', title: evil, markdown: '# X' });
    const prCall = calls.find((c) => c.cmd === 'gh' && c.args[0] === 'pr');
    expect(prCall?.args).toContain(evil); // intact, as one arg — not concatenated into a shell line
  });

  it('refuses an unsafe slug before running anything', async () => {
    const result = await createImprovementPr({
      cwd,
      slug: '../../etc/passwd',
      title: 'X',
      markdown: '# X',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unsafe slug/);
    expect(calls).toHaveLength(0);
  });

  it('fails gracefully when gh is missing', async () => {
    handler = (cmd) => {
      if (cmd === 'gh') throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return { stdout: '', stderr: '' };
    };
    const result = await createImprovementPr({ cwd, slug: 'x-3', title: 'X', markdown: '# X' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/gh CLI not found/);
  });

  it('fails gracefully when the working tree is dirty', async () => {
    const base = happyHandler();
    handler = (cmd, args) => {
      if (cmd === 'git' && args[0] === 'status') return { stdout: ' M src/x.ts', stderr: '' };
      return base(cmd, args);
    };
    const result = await createImprovementPr({ cwd, slug: 'x-4', title: 'X', markdown: '# X' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/uncommitted changes/);
  });

  it('aborts if anything beyond the markdown file gets staged', async () => {
    const base = happyHandler();
    handler = (cmd, args) => {
      if (cmd === 'git' && args.includes('--cached') && args.includes('--name-only')) {
        return { stdout: 'improvements/x-5.md\nsrc/evil.ts', stderr: '' };
      }
      return base(cmd, args);
    };
    const result = await createImprovementPr({ cwd, slug: 'x-5', title: 'X', markdown: '# X' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Unexpected staged files/);
  });
});
