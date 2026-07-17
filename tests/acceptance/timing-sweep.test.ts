/**
 * ASR-based sync scoring and parameter sweep.
 *
 * Method: use ASR word-level timestamps as ground truth to measure
 * how well merged cue timing matches actual speech.
 *
 * Scoring criteria (from user feedback):
 *   1. Best: subtitle appears synchronized with speech (like manual subtitles)
 *   2. Slightly early > slightly late
 *   3. Should NOT switch before speaker finishes the sentence
 *
 * Sweep covers both LEAD params and merge boundary params (maxChars, maxTime).
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSubtitleResponse } from '@/entrypoints/content/youtube/subtitle-fetcher';
import { mergeCues, type PostProcessConfig } from '@/entrypoints/content/youtube/cue-merger';
import { scoreMerge, parseAsrWords, formatScoreRow, type SyncScore } from '../helpers/sync-scorer';

function loadJsonFixture(name: string): string {
  return readFileSync(join(__dirname, '..', 'fixtures', name), 'utf-8');
}

interface ASRFixture {
  name: string;
  file: string;
  rawJson: string;
}

const ASR_FIXTURES: ASRFixture[] = [
  { name: 'AUcYJczWXT4 (slow?)', file: 'youtube-timedtext-asr-AUcYJczWXT4.json', rawJson: '' },
  { name: 'bTQM3oEW0gk (OK)', file: 'youtube-timedtext-asr-bTQM3oEW0gk.json', rawJson: '' },
  { name: '-1wUricB7vY (fast?)', file: 'youtube-timedtext-asr--1wUricB7vY.json', rawJson: '' },
];

// Load fixtures once
for (const f of ASR_FIXTURES) {
  f.rawJson = loadJsonFixture(f.file);
}

/** Score a config across all ASR fixtures. Returns per-fixture and avg score. */
function scoreConfig(config: PostProcessConfig): {
  avg: number;
  min: number;
  perFixture: { name: string; score: SyncScore }[];
} {
  const perFixture: { name: string; score: SyncScore }[] = [];
  for (const f of ASR_FIXTURES) {
    const raw = parseSubtitleResponse(f.rawJson);
    const asrWords = parseAsrWords(f.rawJson);
    const merged = mergeCues(raw, config);
    const score = scoreMerge(merged, asrWords);
    perFixture.push({ name: f.name, score });
  }
  const avg = perFixture.reduce((s, r) => s + r.score.score, 0) / perFixture.length;
  const min = Math.min(...perFixture.map((r) => r.score.score));
  return { avg, min, perFixture };
}

// ============================================================
// Baseline analysis
// ============================================================

describe('ASR Sync Score — Baseline', () => {
  it('current defaults', () => {
    const result = scoreConfig({});
    console.log('\n=== BASELINE (current defaults) ===');
    for (const f of result.perFixture) {
      console.log(formatScoreRow(f.name, f.score));
    }
    console.log(`\nAvg score: ${result.avg.toFixed(4)}  Min: ${result.min.toFixed(4)}`);
  });
});

// ============================================================
// Phase 1: Single-parameter sweep
// ============================================================

describe('ASR Sync Sweep — Phase 1 (single param)', () => {
  const BASELINE: PostProcessConfig = {};

  function sweepParam(
    paramName: string,
    values: number[],
    makeConfig: (v: number) => PostProcessConfig,
  ) {
    const rows: {
      label: string;
      avg: number;
      min: number;
      perFixture: { name: string; score: SyncScore }[];
    }[] = [];
    for (const v of values) {
      const config = makeConfig(v);
      const result = scoreConfig(config);
      rows.push({ label: `${paramName}=${v}`, ...result });
    }
    // Sort by avg score descending
    rows.sort((a, b) => b.avg - a.avg);
    console.log(`\n=== SWEEP: ${paramName} ===`);
    for (const r of rows) {
      // Show avg + per-fixture scores
      const perF = r.perFixture.map((f) => `${f.score.score.toFixed(3)}`).join(' | ');
      console.log(
        `  ${r.label.padEnd(20)} avg=${r.avg.toFixed(4)} min=${r.min.toFixed(4)}  [${perF}]`,
      );
    }
  }

  it('sweep maxChars (merge boundary)', () => {
    sweepParam('maxChars', [40, 50, 60, 70, 80, 90, 100], (v) => ({ ...BASELINE, maxChars: v }));
  });

  it('sweep maxTime (merge boundary)', () => {
    sweepParam('maxTime', [2, 3, 4, 5, 6, 7], (v) => ({ ...BASELINE, maxTime: v }));
  });

  it('sweep clauseMinChars', () => {
    sweepParam('clauseMinChars', [30, 40, 50, 60, 70], (v) => ({ ...BASELINE, clauseMinChars: v }));
  });

  it('sweep clauseMinTime', () => {
    sweepParam('clauseMinTime', [1, 2, 3, 4, 5], (v) => ({ ...BASELINE, clauseMinTime: v }));
  });

  it('sweep leadCoeff', () => {
    sweepParam('leadCoeff', [0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06], (v) => ({
      ...BASELINE,
      leadCoeff: v,
    }));
  });

  it('sweep leadMin', () => {
    sweepParam('leadMin', [0.0, 0.05, 0.1, 0.15, 0.2, 0.3], (v) => ({ ...BASELINE, leadMin: v }));
  });

  it('sweep leadMax', () => {
    sweepParam('leadMax', [0.3, 0.4, 0.5, 0.6, 0.8, 1.0], (v) => ({ ...BASELINE, leadMax: v }));
  });

  it('sweep leadPad', () => {
    sweepParam('leadPad', [0.0, 0.1, 0.2, 0.3, 0.4, 0.5], (v) => ({ ...BASELINE, leadPad: v }));
  });
});

// ============================================================
// Phase 2: Grid search (all params)
// ============================================================

describe('ASR Sync Sweep — Phase 2 (grid search)', () => {
  it('comprehensive grid search', { timeout: 120_000 }, () => {
    // Focused ranges based on typical Phase 1 results
    const maxCharValues = [50, 60, 70, 80];
    const maxTimeValues = [3, 4, 5];
    const leadCoeffValues = [0.02, 0.03, 0.04];
    const leadMinValues = [0.1, 0.2];
    const leadMaxValues = [0.5, 0.6, 0.8];
    const leadPadValues = [0.2, 0.3, 0.4];

    const totalCombinations =
      maxCharValues.length *
      maxTimeValues.length *
      leadCoeffValues.length *
      leadMinValues.length *
      leadMaxValues.length *
      leadPadValues.length;

    console.log(`\n=== GRID SEARCH: ${totalCombinations} combinations ===\n`);

    const results: {
      config: PostProcessConfig;
      avg: number;
      min: number;
      perFixture: { name: string; score: SyncScore }[];
    }[] = [];

    for (const maxChars of maxCharValues) {
      for (const maxTime of maxTimeValues) {
        for (const leadCoeff of leadCoeffValues) {
          for (const leadMin of leadMinValues) {
            for (const leadMax of leadMaxValues) {
              for (const leadPad of leadPadValues) {
                const config: PostProcessConfig = {
                  maxChars,
                  maxTime,
                  leadCoeff,
                  leadMin,
                  leadMax,
                  leadPad,
                };
                const result = scoreConfig(config);
                results.push({ config, ...result });
              }
            }
          }
        }
      }
    }

    // Sort by avg score descending
    results.sort((a, b) => b.avg - a.avg);

    // Print top 20
    console.log('Top 20 by avg score:');
    console.log('─'.repeat(120));
    for (const r of results.slice(0, 20)) {
      const c = r.config;
      const label = `ch=${c.maxChars} t=${c.maxTime} co=${c.leadCoeff} mn=${c.leadMin} mx=${c.leadMax} pd=${c.leadPad}`;
      const perF = r.perFixture
        .map((f) => {
          const s = f.score;
          return `${s.score.toFixed(3)}(ld=${s.firstWordDevAvg.toFixed(2)} cut=${(s.prematureSwitchRate * 100).toFixed(0)}%)`;
        })
        .join(' | ');
      console.log(
        `  ${label.padEnd(50)} avg=${r.avg.toFixed(4)} min=${r.min.toFixed(4)}  [${perF}]`,
      );
    }

    // Sort by min score (best worst-case)
    const byMin = [...results].sort((a, b) => b.min - a.min);
    console.log('\nTop 10 by min score (best worst-case):');
    console.log('─'.repeat(120));
    for (const r of byMin.slice(0, 10)) {
      const c = r.config;
      const label = `ch=${c.maxChars} t=${c.maxTime} co=${c.leadCoeff} mn=${c.leadMin} mx=${c.leadMax} pd=${c.leadPad}`;
      const perF = r.perFixture
        .map((f) => `${f.name.slice(0, 15)}=${f.score.score.toFixed(3)}`)
        .join(' | ');
      console.log(
        `  ${label.padEnd(50)} avg=${r.avg.toFixed(4)} min=${r.min.toFixed(4)}  [${perF}]`,
      );
    }

    // Winner
    const best = results[0];
    console.log('\n=== BEST BY AVG ===');
    console.log('Config:', JSON.stringify(best.config));
    for (const f of best.perFixture) {
      console.log(formatScoreRow(`  ${f.name}`, f.score));
    }

    const bestMin = byMin[0];
    console.log('\n=== BEST BY MIN (robustness) ===');
    console.log('Config:', JSON.stringify(bestMin.config));
    for (const f of bestMin.perFixture) {
      console.log(formatScoreRow(`  ${f.name}`, f.score));
    }
  });
});
