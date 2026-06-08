import * as readline from 'node:readline';
import pc from 'picocolors';
import { createTerminalUI } from './ui/render.js';
import { AgentLoop } from './agent/loop.js';
import { PermissionGate } from './permissions/gate.js';
import type { PermissionPrompt } from './permissions/gate.js';
import { createRegistry } from './tools/registry.js';
import { createProvider } from './providers/index.js';
import { loadConfig } from './config/load.js';
import type { CliOverrides } from './config/load.js';
import { loadProjectContext } from './config/context.js';
import { buildSystemPrompt } from './agent/systemPrompt.js';
import { loadCommands, renderCommand } from './commands/loader.js';
import type { Command } from './commands/types.js';
import { runImprovement } from './improve/run.js';
import {
  MODEL_CATALOG,
  CATALOG_AS_OF,
  getModelInfo,
  estimateCostUsd,
  formatUsd,
  blendedCostPerMTok,
} from './models/catalog.js';
import type { Usage } from './providers/types.js';

function printHelp(commands: Map<string, Command>): void {
  console.log(pc.bold('\nBuilt-in:'));
  console.log('  /help            Show this help');
  console.log('  /clear           Clear the conversation history and start fresh');
  console.log('  /models          Show known models, pricing, and the active one');
  console.log('  /improve         Reflect on this session and propose an improvement PR');
  console.log('  /exit, /quit     Leave the session');
  if (commands.size > 0) {
    console.log(pc.bold('\nCustom commands:'));
    for (const cmd of commands.values()) {
      const hint = cmd.argumentHint ? pc.dim(` ${cmd.argumentHint}`) : '';
      console.log(`  /${cmd.name}${hint}  ${pc.dim(cmd.description)}`);
    }
  }
}

/** Show the model catalog with pricing, ranked cheapest-first, marking the
 *  active model and the live session cost so cost/performance is visible. */
function printModels(activeModel: string, priority: string, usage: Usage): void {
  console.log(
    pc.bold(`\nModels`) +
      pc.dim(` · priority: ${priority} · pricing per 1M tokens · as of ${CATALOG_AS_OF}`),
  );
  const ranked = [...MODEL_CATALOG].sort((a, b) => blendedCostPerMTok(a) - blendedCostPerMTok(b));
  for (const m of ranked) {
    const active = m.id === activeModel;
    const marker = active ? pc.green('●') : ' ';
    const id = active ? pc.bold(m.id.padEnd(22)) : m.id.padEnd(22);
    const detail = pc.dim(
      `in $${m.inputPricePerMTok}/out $${m.outputPricePerMTok}  score ${m.codingScore}`,
    );
    console.log(`${marker} ${id} ${detail}`);
  }
  const info = getModelInfo(activeModel);
  if (info && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
    console.log(
      pc.dim(
        `\nThis session: ↑ ${usage.inputTokens.toLocaleString('en-US')} ↓ ${usage.outputTokens.toLocaleString('en-US')} tokens ≈ ${formatUsd(estimateCostUsd(usage, info))}`,
      ),
    );
  } else if (!info) {
    console.log(pc.dim(`\n(${activeModel} is not in the catalog — no cost estimate available.)`));
  }
}

export async function startRepl(overrides: CliOverrides): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(overrides, cwd);
  const provider = createProvider(config); // throws with a clear message if the API key is missing
  const registry = createRegistry();
  const projectContext = loadProjectContext(cwd);
  const system = buildSystemPrompt({ cwd, projectContext, tools: registry.toSchemas() });
  const commands = loadCommands(config.commandDirs);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt: PermissionPrompt = (req) =>
    new Promise((resolve) => {
      const label = pc.yellow(`\nAllow ${req.toolName}?`);
      rl.question(`${label} ${pc.dim(req.summary)} [y/N/a] `, (answer) => {
        const a = answer.trim().toLowerCase();
        if (a === 'a' || a === 'always') resolve('always');
        else if (a === 'y' || a === 'yes') resolve('yes');
        else resolve('no');
      });
    });

  const gate = new PermissionGate(config.allow, prompt);
  const modelInfo = getModelInfo(config.model);
  const ui = createTerminalUI(modelInfo);
  const agent = new AgentLoop({
    provider,
    registry,
    gate,
    system,
    ui,
    cwd,
    maxIterations: config.maxIterations,
  });

  // Tracks the transcript length at the last reflection, so the auto-trigger on
  // exit doesn't re-run when nothing happened since a manual /improve.
  let lastImprovedAt = 0;

  const confirmPr = (title: string): Promise<boolean> =>
    new Promise((resolve) => {
      const label = pc.yellow('\nOpen a PR with this improvement?');
      rl.question(`${label} ${pc.dim(title)} [y/N] `, (answer) => {
        resolve(/^y(es)?$/i.test(answer.trim()));
      });
    });

  const improve = async (): Promise<void> => {
    lastImprovedAt = agent.getMessages().length;
    await runImprovement({
      provider,
      messages: agent.getMessages(),
      cwd,
      baseBranch: config.improve.baseBranch,
      log: (line) => console.log(pc.dim(line)),
      confirm: confirmPr,
    });
  };

  // Auto-reflect when leaving via /exit or /quit — runs while readline is still
  // open so the confirmation prompt works. Skipped if nothing happened since the
  // last manual /improve.
  const maybeAutoImprove = async (): Promise<void> => {
    if (
      config.improve.enabled &&
      config.improve.onSessionEnd &&
      agent.getMessages().length > lastImprovedAt
    ) {
      console.log(pc.dim('\nReflecting on this session…'));
      await improve();
    }
  };

  const priceTag = modelInfo
    ? ` · $${modelInfo.inputPricePerMTok}/$${modelInfo.outputPricePerMTok} per 1M in/out`
    : '';
  console.log(
    pc.bold('tiny-code') +
      pc.dim(` · ${provider.name}:${provider.model}${priceTag} · ${cwd}`),
  );
  if (projectContext.trim().length > 0) {
    console.log(pc.dim('Loaded project context.'));
  }
  console.log(pc.dim('Type a request, /help for commands, /exit to quit.'));

  const handle = async (line: string): Promise<void> => {
    const input = line.trim();
    if (input.length === 0) {
      ask();
      return;
    }
    if (input === '/exit' || input === '/quit') {
      await maybeAutoImprove();
      rl.close();
      return;
    }
    if (input === '/help') {
      printHelp(commands);
      ask();
      return;
    }
    if (input === '/clear') {
      agent.clearHistory();
      console.log(pc.dim('Conversation history cleared.'));
      ask();
      return;
    }
    if (input === '/models') {
      printModels(config.model, config.priority, agent.getUsage());
      ask();
      return;
    }
    if (input === '/improve') {
      if (config.improve.enabled) {
        await improve();
      } else {
        console.log(pc.dim('Self-improvement is disabled in config.'));
      }
      ask();
      return;
    }

    let userMessage = input;
    if (input.startsWith('/')) {
      const [name, ...rest] = input.slice(1).split(' ');
      const cmd = name ? commands.get(name) : undefined;
      if (!cmd) {
        console.log(pc.red(`Unknown command: /${name ?? ''} (try /help)`));
        ask();
        return;
      }
      userMessage = renderCommand(cmd, rest.join(' '));
    }

    try {
      await agent.run(userMessage);
    } catch (err) {
      console.error(pc.red(`\nError: ${(err as Error).message}`));
    }
    ask();
  };

  const ask = (): void => {
    rl.question(pc.green('\n› '), (line) => {
      void handle(line);
    });
  };

  rl.on('close', () => {
    const usage = agent.getUsage();
    if (usage.inputTokens > 0 || usage.outputTokens > 0) {
      const fmtN = (n: number) => n.toLocaleString('en-US');
      const cost = modelInfo ? ` ≈ ${formatUsd(estimateCostUsd(usage, modelInfo))}` : '';
      console.log(
        pc.dim(
          `\nSession: ↑ ${fmtN(usage.inputTokens)}  ↓ ${fmtN(usage.outputTokens)} tokens total${cost}`,
        ),
      );
    }
    console.log(pc.dim('Bye.'));
    process.exit(0);
  });

  ask();
}
