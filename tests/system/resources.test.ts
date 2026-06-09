import { describe, it, expect } from 'vitest';
import { checkLocalModel, estimateModelRamGb, parseParamsB } from '../../src/system/resources.js';

const GB = 1024 ** 3;

describe('parseParamsB / estimateModelRamGb', () => {
  it('extracts billions of params from a tag', () => {
    expect(parseParamsB('gemma3:12b')).toBe(12);
    expect(parseParamsB('qwen2.5-coder:1.5b')).toBe(1.5);
    expect(parseParamsB('mystery-model')).toBeUndefined();
  });

  it('uses the explicit table when available, else a size-based estimate', () => {
    expect(estimateModelRamGb('gemma3:12b')).toBe(7);
    // unknown 20b model -> 20*0.6 + 1.5 ~= 14 (rounded)
    expect(estimateModelRamGb('something:20b')).toBe(Math.round(20 * 0.6 + 1.5));
  });
});

describe('checkLocalModel', () => {
  it('warns when the model needs more than the free memory', () => {
    const check = checkLocalModel('gemma3:27b', { total: 8 * GB, free: 4 * GB }); // ~16GB
    expect(check.warn).toBe(true);
    expect(check.needGb).toBe(16);
  });

  it('does not warn when there is ample free memory and flags small-model tool risk', () => {
    const check = checkLocalModel('gemma3:1b', { total: 64 * GB, free: 48 * GB });
    expect(check.warn).toBe(false);
    expect(check.toolCallRisk).toBe(true);
  });
});
