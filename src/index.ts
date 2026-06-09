/**
 * Public programmatic API. The CLI is the primary surface, but these exports
 * let you embed the agent loop, register custom tools, or swap providers.
 */
export type { Message, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock, Role } from './agent/types.js';
export { AgentLoop } from './agent/loop.js';
export type { AgentUI, AgentLoopOptions } from './agent/loop.js';
export { buildSystemPrompt } from './agent/systemPrompt.js';
export type { SystemPromptParams } from './agent/systemPrompt.js';

export { createProvider, AnthropicProvider, GeminiProvider, OllamaProvider } from './providers/index.js';
export type { ModelProvider, ProviderEvent, SendRequest, ToolSchema, Usage } from './providers/types.js';
export { toOpenAiMessages, toOpenAiTools } from './providers/ollama.js';

export { classifyTurn } from './agent/router.js';
export type { TaskWeight } from './agent/router.js';
export { checkLocalModel, estimateModelRamGb, MODEL_RAM_GB } from './system/resources.js';
export type { LocalModelCheck } from './system/resources.js';

export { ALL_TOOLS, createRegistry, toJsonSchema } from './tools/registry.js';
export type { ToolRegistry } from './tools/registry.js';
export { defineTool } from './tools/types.js';
export { escalateTool } from './tools/escalate.js';
export type { Tool, ToolContext, ToolResult } from './tools/types.js';

export { PermissionGate } from './permissions/gate.js';
export type { PermissionPrompt, PermissionRequest, PermissionChoice } from './permissions/gate.js';

export { loadConfig } from './config/load.js';
export type { ResolvedConfig, CliOverrides, Provider, Effort, Priority, AllowRules, Routing, EscalateTarget } from './config/load.js';

export {
  MODEL_CATALOG,
  CATALOG_AS_OF,
  getModelInfo,
  estimateCostUsd,
  formatUsd,
  blendedCostPerMTok,
  recommendModel,
} from './models/catalog.js';
export type { ModelInfo, RecommendOptions } from './models/catalog.js';
export { loadProjectContext } from './config/context.js';

export { loadCommands, renderCommand } from './commands/loader.js';
export type { Command } from './commands/types.js';
