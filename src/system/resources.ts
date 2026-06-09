import { totalmem, freemem } from 'node:os';

/**
 * Approximate memory needed to run common local models at ~Q4 quantization,
 * in GB (weights + a modest KV cache / runtime overhead). These are guidelines
 * for the startup advisory, not exact figures — long contexts need more.
 */
export const MODEL_RAM_GB: Record<string, number> = {
  'gemma3:1b': 1,
  'gemma3:4b': 3,
  'gemma3:12b': 7,
  'gemma3:27b': 16,
  'qwen2.5-coder:1.5b': 2,
  'qwen2.5-coder:7b': 5,
  'qwen2.5-coder:14b': 9,
  'qwen2.5-coder:32b': 18,
  'llama3.2:3b': 3,
  'llama3.1:8b': 6,
};

const GB = 1024 ** 3;

/** Parse a parameter count (in billions) out of a model tag like "gemma3:12b". */
export function parseParamsB(model: string): number | undefined {
  const match = model.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  return match ? Number(match[1]) : undefined;
}

/** Estimate RAM (GB) for a model: explicit table first, else a size-based guess. */
export function estimateModelRamGb(model: string): number {
  const known = MODEL_RAM_GB[model.toLowerCase()];
  if (known !== undefined) return known;
  const params = parseParamsB(model);
  // ~0.6 GB per billion params at Q4, plus ~1.5 GB runtime/KV-cache overhead.
  return params !== undefined ? Math.round(params * 0.6 + 1.5) : 4;
}

export interface LocalModelCheck {
  needGb: number;
  totalGb: number;
  freeGb: number;
  /** True when the model likely won't fit comfortably in free memory. */
  warn: boolean;
  /** True for small models (≤3B) that tool-call unreliably. */
  toolCallRisk: boolean;
}

/**
 * Compare a local model's memory footprint against the host's available RAM.
 * `mem` defaults to the live host readings but can be injected for testing.
 */
export function checkLocalModel(
  model: string,
  mem: { total: number; free: number } = { total: totalmem(), free: freemem() },
): LocalModelCheck {
  const needGb = estimateModelRamGb(model);
  const totalGb = mem.total / GB;
  const freeGb = mem.free / GB;
  const params = parseParamsB(model);
  return {
    needGb,
    totalGb: round1(totalGb),
    freeGb: round1(freeGb),
    warn: needGb > freeGb,
    toolCallRisk: params !== undefined && params <= 3,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
