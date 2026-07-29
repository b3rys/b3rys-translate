import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const contentSource = readFileSync(resolve(__dirname, '../entrypoints/content.ts'), 'utf-8');

describe('content translation-mode event guards', () => {
  it('guards FAB, cross-tab, and popup mode application paths', () => {
    const guardedCalls = contentSource.match(
      /setTranslationModeWhenAvailable\((?:mode|message\.mode)\)/g,
    );

    expect(guardedCalls).toHaveLength(3);
  });
});
