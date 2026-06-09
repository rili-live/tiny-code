import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config/load.js';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'TINY_CODE_PROVIDER',
  'TINY_CODE_MODEL',
  'TINY_CODE_PRIORITY',
  'TINY_CODE_MAX_TOKENS',
  'TINY_CODE_EFFORT',
  'TINY_CODE_OLLAMA_URL',
  'TINY_CODE_IMPROVE',
  'HOME',
];

let cwd: string;
let saved: Record<string, string | undefined>;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'tiny-code-cfg-'));
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Isolate from any real ~/.config/tiny-code/config.json
  process.env.HOME = cwd;
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await rm(cwd, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('infers anthropic when only ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const cfg = loadConfig({}, cwd);
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.model).toBe('claude-opus-4-8');
    expect(cfg.anthropicApiKey).toBe('sk-test');
  });

  it('infers gemini when only GEMINI_API_KEY is set', () => {
    process.env.GEMINI_API_KEY = 'g-test';
    const cfg = loadConfig({}, cwd);
    expect(cfg.provider).toBe('gemini');
    expect(cfg.model).toBe('gemini-2.5-pro');
  });

  it('lets CLI overrides win over env and defaults', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const cfg = loadConfig({ provider: 'gemini', model: 'custom-model' }, cwd);
    expect(cfg.provider).toBe('gemini');
    expect(cfg.model).toBe('custom-model');
  });

  it('reads a project config file', async () => {
    await writeFile(
      join(cwd, 'tiny-code.config.json'),
      JSON.stringify({
        provider: 'anthropic',
        maxTokens: 8000,
        effort: 'max',
        allow: { bash: ['npm test'], write: ['src/**'] },
      }),
    );
    const cfg = loadConfig({}, cwd);
    expect(cfg.maxTokens).toBe(8000);
    expect(cfg.effort).toBe('max');
    expect(cfg.allow.bash).toEqual(['npm test']);
    expect(cfg.allow.write).toEqual(['src/**']);
  });

  it('enables self-improvement by default', () => {
    const cfg = loadConfig({}, cwd);
    expect(cfg.improve.enabled).toBe(true);
    expect(cfg.improve.baseBranch).toBe('main');
    expect(cfg.improve.onSessionEnd).toBe(true);
  });

  it('lets TINY_CODE_IMPROVE=0 disable the feature over a config file', async () => {
    await writeFile(
      join(cwd, 'tiny-code.config.json'),
      JSON.stringify({ improve: { enabled: true } }),
    );
    process.env.TINY_CODE_IMPROVE = '0';
    const cfg = loadConfig({}, cwd);
    expect(cfg.improve.enabled).toBe(false);
  });

  it('reads improve settings from a config file', async () => {
    await writeFile(
      join(cwd, 'tiny-code.config.json'),
      JSON.stringify({ improve: { enabled: false, baseBranch: 'develop', onSessionEnd: false } }),
    );
    const cfg = loadConfig({}, cwd);
    expect(cfg.improve.enabled).toBe(false);
    expect(cfg.improve.baseBranch).toBe('develop');
    expect(cfg.improve.onSessionEnd).toBe(false);
  });

  it('defaults to performance priority and the most capable model', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const cfg = loadConfig({}, cwd);
    expect(cfg.priority).toBe('performance');
    expect(cfg.model).toBe('claude-opus-4-8');
  });

  it('auto-selects a cheaper model when priority is cost', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.TINY_CODE_PRIORITY = 'cost';
    const cfg = loadConfig({}, cwd);
    expect(cfg.priority).toBe('cost');
    expect(cfg.model).toBe('claude-haiku-4-5');
  });

  it('lets a pinned model win over the priority recommendation', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const cfg = loadConfig({ model: 'claude-opus-4-8' }, cwd);
    expect(cfg.priority).toBe('performance');
    expect(cfg.model).toBe('claude-opus-4-8');
  });

  it('reads priority from a config file', async () => {
    await writeFile(
      join(cwd, 'tiny-code.config.json'),
      JSON.stringify({ provider: 'gemini', priority: 'balanced' }),
    );
    const cfg = loadConfig({}, cwd);
    expect(cfg.priority).toBe('balanced');
  });

  it('lets env override the config file model', async () => {
    await writeFile(
      join(cwd, 'tiny-code.config.json'),
      JSON.stringify({ provider: 'anthropic', model: 'from-file' }),
    );
    process.env.TINY_CODE_MODEL = 'from-env';
    const cfg = loadConfig({}, cwd);
    expect(cfg.model).toBe('from-env');
  });

  it('supports the ollama provider with its default model and base URL', () => {
    const cfg = loadConfig({ provider: 'ollama' }, cwd);
    expect(cfg.provider).toBe('ollama');
    expect(cfg.model).toBe('qwen2.5-coder:7b');
    expect(cfg.ollamaBaseUrl).toBe('http://localhost:11434/v1');
  });

  it('honors TINY_CODE_OLLAMA_URL over the default', () => {
    process.env.TINY_CODE_OLLAMA_URL = 'http://gpu-box:11434/v1';
    const cfg = loadConfig({ provider: 'ollama' }, cwd);
    expect(cfg.ollamaBaseUrl).toBe('http://gpu-box:11434/v1');
  });

  it('defaults routing to local-first when an escalateTo target is configured', async () => {
    await writeFile(
      join(cwd, 'tiny-code.config.json'),
      JSON.stringify({
        provider: 'ollama',
        model: 'gemma3:12b',
        escalateTo: { provider: 'anthropic', model: 'claude-opus-4-8' },
      }),
    );
    const cfg = loadConfig({}, cwd);
    expect(cfg.routing).toBe('local-first');
    expect(cfg.escalateTo).toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' });
  });

  it('defaults routing to off with no escalateTo target', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const cfg = loadConfig({}, cwd);
    expect(cfg.routing).toBe('off');
    expect(cfg.escalateTo).toBeUndefined();
  });
});
