import { describe, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSubtitleResponse } from '@/entrypoints/content/youtube/subtitle-fetcher';
import { mergeCues } from '@/entrypoints/content/youtube/cue-merger';
import type { SubtitleCue } from '@/types';

function loadJsonFixture(name: string): string {
  return readFileSync(join(__dirname, '..', 'fixtures', name), 'utf-8');
}

/** Parse raw ASR events preserving per-event start + word offsets. */
function parseAsrEvents(
  jsonText: string,
): { startSec: number; endSec: number; words: { time: number; word: string }[] }[] {
  const data = JSON.parse(jsonText);
  const events: { startSec: number; endSec: number; words: { time: number; word: string }[] }[] =
    [];
  for (const event of data.events ?? []) {
    const segs = event.segs as { utf8: string; tOffsetMs?: number }[] | undefined;
    if (!segs) continue;
    const baseMs = (event.tStartMs as number) ?? 0;
    const durMs = (event.dDurationMs as number) ?? 0;
    const words: { time: number; word: string }[] = [];
    for (const seg of segs) {
      const w = seg.utf8.trim();
      if (!w || w === '\n') continue;
      words.push({ time: (baseMs + (seg.tOffsetMs ?? 0)) / 1000, word: w });
    }
    if (words.length > 0) {
      events.push({ startSec: baseMs / 1000, endSec: (baseMs + durMs) / 1000, words });
    }
  }
  return events;
}

/**
 * Time-based sync analysis: for each merged cue, find ASR words near
 * its time range and measure deviation.
 *
 * Uses binary search on ASR word timestamps (not sequential matching)
 * so it works reliably for long videos without drift.
 */
function analyzeCueSync(
  merged: SubtitleCue[],
  asrEvents: { startSec: number; endSec: number; words: { time: number; word: string }[] }[],
) {
  // Flatten all ASR words with timing, sorted by time
  const allWords = asrEvents.flatMap((e) => e.words);

  const results: {
    idx: number;
    cueStart: number;
    firstWordTime: number;
    lastWordTime: number;
    firstWordDev: number; // positive = cue shown BEFORE word spoken
    lastWordDev: number; // positive = word shown BEFORE spoken (premature)
    text: string;
  }[] = [];

  const strip = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

  /** Binary search: find first ASR word index with time >= t */
  function lowerBound(t: number): number {
    let lo = 0,
      hi = allWords.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (allWords[mid].time < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  for (let ci = 0; ci < merged.length; ci++) {
    const cue = merged[ci];
    const cueWords = cue.text.split(/\s+/).filter(Boolean);
    if (cueWords.length === 0) continue;

    const firstCueWord = strip(cueWords[0]);
    const lastCueWord = strip(cueWords[cueWords.length - 1]);

    // Search ASR words in a time window around the cue
    // Window: [cue.start - 2s, cue.start + cue.duration + 2s]
    const windowStart = Math.max(0, cue.start - 2);
    const windowEnd = cue.start + cue.duration + 2;
    const startIdx = lowerBound(windowStart);
    const endIdx = lowerBound(windowEnd);

    if (startIdx >= allWords.length) continue;

    // Find first word match in window
    let firstMatch = -1;
    for (let i = startIdx; i < Math.min(endIdx, allWords.length); i++) {
      if (strip(allWords[i].word) === firstCueWord) {
        firstMatch = i;
        break;
      }
    }
    if (firstMatch === -1) continue;

    // Find last word match (search forward from first match, limited by cue word count + margin)
    let lastMatch = firstMatch;
    const searchEnd = Math.min(firstMatch + cueWords.length + 15, allWords.length);
    for (let i = firstMatch; i < searchEnd; i++) {
      if (strip(allWords[i].word) === lastCueWord) {
        lastMatch = i;
      }
    }

    const firstWordTime = allWords[firstMatch].time;
    const lastWordTime = allWords[lastMatch].time;

    results.push({
      idx: ci,
      cueStart: cue.start,
      firstWordTime,
      lastWordTime,
      firstWordDev: firstWordTime - cue.start, // positive = cue appears early (good per user)
      lastWordDev: lastWordTime - cue.start, // how early last word appears (premature display)
      text: cue.text.slice(0, 60),
    });
  }

  return results;
}

const fixtures = [
  { name: 'ASR -1wUricB7vY', file: 'youtube-timedtext-asr--1wUricB7vY.json' },
  { name: 'ASR bTQM3oEW0gk', file: 'youtube-timedtext-asr-bTQM3oEW0gk.json' },
  { name: 'ASR AUcYJczWXT4', file: 'youtube-timedtext-asr-AUcYJczWXT4.json' },
];

describe('ASR sync deviation — merged vs word-level timing', () => {
  for (const f of fixtures) {
    it(`${f.name}`, () => {
      const json = loadJsonFixture(f.file);
      const raw = parseSubtitleResponse(json);
      const asrEvents = parseAsrEvents(json);
      const merged = mergeCues(raw);

      const results = analyzeCueSync(merged, asrEvents);
      if (results.length === 0) {
        console.log(`\n=== ${f.name}: no matches ===`);
        return;
      }

      // First word deviation: how early the cue appears vs first word spoken
      const firstDevs = results.map((r) => r.firstWordDev);
      // Last word premature: how much time passes between cue display and last word spoken
      const lastDevs = results.map((r) => r.lastWordDev);

      const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
      const p = (arr: number[], pct: number) => {
        const sorted = [...arr].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * pct)];
      };

      console.log(`\n=== ${f.name} ===`);
      console.log(`Matched ${results.length}/${merged.length} cues to ASR words`);

      console.log(`\nFirst word (cue appears vs word spoken):`);
      console.log(
        `  avg=${avg(firstDevs).toFixed(2)}s  p50=${p(firstDevs, 0.5).toFixed(2)}s  p90=${p(firstDevs, 0.9).toFixed(2)}s`,
      );
      console.log(`  (positive = cue shown BEFORE speech → user prefers this)`);

      console.log(`\nLast word premature display (shown at cue.start, spoken later):`);
      console.log(
        `  avg=${avg(lastDevs).toFixed(2)}s  p50=${p(lastDevs, 0.5).toFixed(2)}s  p90=${p(lastDevs, 0.9).toFixed(2)}s`,
      );
      console.log(`  (larger = more text shown before it's spoken)`);

      // Show worst offenders (largest last-word premature)
      const worstPremature = [...results].sort((a, b) => b.lastWordDev - a.lastWordDev).slice(0, 5);
      console.log(`\nTop 5 most premature (last word shown N sec before spoken):`);
      for (const r of worstPremature) {
        console.log(`  [${r.idx}] ${r.lastWordDev.toFixed(1)}s early "${r.text}"`);
      }

      // Show sample of typical cues
      console.log(`\nSample cues (every 20th):`);
      for (let i = 0; i < results.length; i += 20) {
        const r = results[i];
        console.log(
          `  [${r.idx}] show@${r.cueStart.toFixed(1)} 1st@${r.firstWordTime.toFixed(1)}(${r.firstWordDev >= 0 ? '+' : ''}${r.firstWordDev.toFixed(1)}) last@${r.lastWordTime.toFixed(1)}(+${r.lastWordDev.toFixed(1)}) "${r.text.slice(0, 40)}"`,
        );
      }
    });
  }
});
