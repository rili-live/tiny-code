import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { startRepl } from './repl.js';
import type { CliOverrides, Provider } from './config/load.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const USAGE = `tiny-code — a small, extensible CLI coding agent

Usage:
  tiny-code [options]

Options:
  --provider <name>   anthropic | gemini | ollama | deepseek | qwen
                      (default: inferred from API keys)
  --model <id>        Model id override (e.g. claude-opus-4-8, qwen3-coder-plus)
  --config <path>     Path to a config JSON file
  -v, --version       Print version
  -h, --help          Show this help

Environment:
  ANTHROPIC_API_KEY    Required for the Anthropic provider
  GEMINI_API_KEY       Required for the Gemini provider
  DEEPSEEK_API_KEY     Required for the DeepSeek provider
  QWEN_API_KEY         Required for the Qwen provider (or DASHSCOPE_API_KEY)
  TINY_CODE_OLLAMA_URL Ollama OpenAI-compatible base URL (default http://localhost:11434/v1)
  TINY_CODE_PRIORITY   performance | cost | balanced — auto-picks a model when
                       none is pinned (default: balanced)

Cost-saving: set "routing": "local-first" with an "escalateTo" target in your
config to run cheap/local models by default and escalate heavy tasks. Run /costs
in the session for usage and tips.
`;

function main(): void {
  const { values } = parseArgs({
    options: {
      provider: { type: 'string' },
      model: { type: 'string' },
      config: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (values.version) {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  const overrides: CliOverrides = {};
  if (values.provider) overrides.provider = values.provider as Provider;
  if (values.model) overrides.model = values.model;
  if (values.config) overrides.configPath = values.config;

  startRepl(overrides).catch((err: unknown) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  });
}

main();
