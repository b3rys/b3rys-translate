import { describe, it, expect } from 'vitest';
import { getModelConfig, type ModelId } from '@/utils/models';
import { ENGINE_DISPLAY_NAMES, type EngineType } from '@/utils/engines/types';

function labelFor(usageKey: string): string {
  let label: string;
  try {
    label = getModelConfig(usageKey as ModelId).label;
  } catch {
    label = ENGINE_DISPLAY_NAMES[usageKey as EngineType] ?? usageKey;
  }
  return label;
}

describe('legacy engine bucket vs new model bucket labels', () => {
  it('shows the collision', () => {
    // realistic post-upgrade storage: legacy engine keys + new modelId keys
    const usageKeys = [
      'gemini',
      'gemini-3.1-flash-lite',
      'anthropic',
      'claude-haiku-4-5-20251001',
      'openai',
      'gpt-5.4-nano',
    ];
    const labels = usageKeys.map(labelFor);
    console.log(JSON.stringify(labels));
    const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
    console.log('DUPLICATE LABELS:', JSON.stringify(dupes));
    expect(dupes.length).toBe(0);
  });
});
