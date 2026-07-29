import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const translatorCss = readFileSync(
  resolve(__dirname, '../entrypoints/content/translator.css'),
  'utf-8',
);

describe('translation mode CSS visibility fail-safe', () => {
  it('overrides original hiding for the translations-off + replace combination', () => {
    expect(translatorCss).toMatch(
      /body\.b3rys-hiding-translations\.b3rys-replace-mode\s+\[data-b3rys-original\]\s*\{[^}]*display:\s*revert\s*;/,
    );
  });

  it('retains normal replace-mode and translation-hiding rules', () => {
    expect(translatorCss).toMatch(
      /body\.b3rys-replace-mode\s+\[data-b3rys-original\]\s*\{[^}]*display:\s*none\s*;/,
    );
    expect(translatorCss).toMatch(
      /body\.b3rys-hiding-translations\s+\[data-b3rys-translated\]\s*\{[^}]*display:\s*none\s*!important\s*;/,
    );
  });
});
