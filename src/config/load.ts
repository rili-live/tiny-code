import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Priority } from '../models/catalog.js';
import { recommendModel } from '../models/catalog.js';

export type Provider = 'anthropic' | 'gemini' | 'ollama';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type Routing = 'local-first' | 'off';
export type { Priority } from '../models/catalog.js';

/** A frontier model to escalate heavy tasks to under local-first routing. */
export interface EscalateTarget {
  provider: Provider;
  model: string;
  ollamaBaseUrl?: string | undefined;
}

/** Auto-approval rules that bypass the interactive permission prompt. */
export interface AllowRules {
  /** Tool names that never prompt (in addition to read-only tools). */
  tools: string[];
  /** Bash command prefixes that auto-approve (e.g. "npm test", "git status"). */
  bash: string[];
  /** Write/edit path globs that auto-approve (e.g. "src/**"). */
  write: string[];
}

export interface ResolvedConfig {
  provider: Provider;
  model: string;
  /** Cost/performance bias used to auto-pick a model when none is pinned. */
  priority: Priority;
  anthropicApiKey: string | undefined;
  geminiApiKey: string | undefined;
  /** OpenAI-compatible base URL for the Ollama provider. */
  ollamaBaseUrl: string;
  maxTokens: number;
  thinking: boolean;
  effort: Effort;
  maxIterations: number;
  /** 'local-first' starts turns on the cheap model and escalates heavy ones. */
  routing: Routing;
  /** Frontier model heavy tasks escalate to (only used when routing is 'local-first'). */
  escalateTo: EscalateTarget | undefined;
  commandDirs: string[];
  allow: AllowRules;
  improve: ImproveConfig;
}

/** Settings for the self-improvement / proposal-PR feature. */
export interface ImproveConfig {
  /** Master switch for the whole feature (manual and automatic). */
  enabled: boolean;
  /** Branch PRs target. */
  baseBranch: string;
  /** Whether to reflect automatically when the session ends. */
  onSessionEnd: boolean;
}

export interface CliOverrides {
  provider?: Provider;
  model?: string;
  configPath?: string;
}

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-4-8',
  gemini: 'gemini-2.5-pro',
  ollama: 'qwen2.5-coder:7b',
};

const DEFAULT_OLLAMA_URL = 'http://localhost:11434/v1';

const EscalateTargetSchema = z.object({
  provider: z.enum(['anthropic', 'gemini', 'ollama']),
  model: z.string(),
  ollamaBaseUrl: z.string().url().optional(),
});

const FileConfigSchema = z
  .object({
    provider: z.enum(['anthropic', 'gemini', 'ollama']).optional(),
    model: z.string().optional(),
    ollamaBaseUrl: z.string().url().optional(),
    priority: z.enum(['performance', 'cost', 'balanced']).optional(),
    maxTokens: z.number().int().positive().optional(),
    thinking: z.boolean().optional(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
    maxIterations: z.number().int().positive().optional(),
    routing: z.enum(['local-first', 'off']).optional(),
    escalateTo: EscalateTargetSchema.optional(),
    commandDirs: z.array(z.string()).optional(),
    allow: z
      .object({
        tools: z.array(z.string()).optional(),
        bash: z.array(z.string()).optional(),
        write: z.array(z.string()).optional(),
      })
      .optional(),
    improve: z
      .object({
        enabled: z.boolean().optional(),
        baseBranch: z.string().optional(),
        onSessionEnd: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

export type FileConfig = z.infer<typeof FileConfigSchema>;

function readFileConfig(path: string): FileConfig {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  return FileConfigSchema.parse(JSON.parse(raw));
}

/**
 * Resolve configuration with precedence: defaults < config file < env < CLI flags.
 * Provider defaults to whichever API key is present (Anthropic wins if both).
 */
export function loadConfig(overrides: CliOverrides = {}, cwd: string = process.cwd()): ResolvedConfig {
  const home = homedir();
  const homeConfig = readFileConfig(join(home, '.config', 'tiny-code', 'config.json'));
  const projectConfig = overrides.configPath
    ? readFileConfig(overrides.configPath)
    : readFileConfig(join(cwd, 'tiny-code.config.json'));
  const file: FileConfig = { ...homeConfig, ...projectConfig };

  const env = process.env;
  const anthropicApiKey = env.ANTHROPIC_API_KEY || undefined;
  const geminiApiKey = env.GEMINI_API_KEY || undefined;

  const provider: Provider =
    overrides.provider ??
    (env.TINY_CODE_PROVIDER as Provider | undefined) ??
    file.provider ??
    (anthropicApiKey ? 'anthropic' : geminiApiKey ? 'gemini' : 'anthropic');

  const priority: Priority =
    (env.TINY_CODE_PRIORITY as Priority | undefined) ?? file.priority ?? 'performance';

  // When the user pins a model, honor it. Otherwise let the catalog pick the
  // best fit for the cost/performance priority, falling back to a static
  // default if the catalog has no entry for the provider.
  const pinnedModel = overrides.model ?? env.TINY_CODE_MODEL ?? file.model;
  const model =
    pinnedModel ??
    recommendModel({ provider, priority })?.id ??
    DEFAULT_MODELS[provider];

  const maxTokens = env.TINY_CODE_MAX_TOKENS
    ? Number(env.TINY_CODE_MAX_TOKENS)
    : (file.maxTokens ?? 16_000);

  const effort = (env.TINY_CODE_EFFORT as Effort | undefined) ?? file.effort ?? 'high';

  const ollamaBaseUrl = env.TINY_CODE_OLLAMA_URL ?? file.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL;

  const escalateTo = file.escalateTo;
  // Default to local-first whenever an escalation target is configured.
  const routing: Routing = file.routing ?? (escalateTo ? 'local-first' : 'off');

  const defaultCommandDirs = [
    join(cwd, '.agent', 'commands'),
    join(home, '.config', 'tiny-code', 'commands'),
  ];

  return {
    provider,
    model,
    priority,
    anthropicApiKey,
    geminiApiKey,
    ollamaBaseUrl,
    maxTokens,
    thinking: file.thinking ?? true,
    effort,
    maxIterations: file.maxIterations ?? 50,
    routing,
    escalateTo,
    commandDirs: file.commandDirs ?? defaultCommandDirs,
    allow: {
      tools: file.allow?.tools ?? [],
      bash: file.allow?.bash ?? [],
      write: file.allow?.write ?? [],
    },
    improve: {
      enabled:
        env.TINY_CODE_IMPROVE === '0'
          ? false
          : env.TINY_CODE_IMPROVE === '1'
            ? true
            : (file.improve?.enabled ?? true),
      baseBranch: file.improve?.baseBranch ?? 'main',
      onSessionEnd: file.improve?.onSessionEnd ?? true,
    },
  };
}
