/**
 * ASR word-level sync scoring for merged subtitle cues.
 *
 * Uses ASR word timestamps as ground truth to measure how well
 * merged cue timing matches actual speech. Higher score = better sync.
 *
 * Scoring criteria (user-defined priority):
 *   1. Subtitle should appear synchronized with speech (like manual subtitles)
 *   2. Slightly early is better than late
 *   3. Should NOT switch before the speaker finishes the sentence
 */
import type { SubtitleCue } from '@/types';

export interface ASRWord {
  time: number;
  word: string;
}

export interface CueSyncDetail {
  idx: number;
  cueStart: number;
  switchTime: number; // when this cue gets replaced by next (or its own end)
  firstWordTime: number;
  lastWordTime: number;
  leadTime: number; // firstWordTime - cueStart (positive = cue early)
  postSpeechBuffer: number; // switchTime - lastWordTime (negative = premature switch)
}

export interface SyncScore {
  /** Composite score 0-1 (higher = better sync) */
  score: number;
  /** How many merged cues matched to ASR words */
  matchRate: number;
  /** First word deviation: avg seconds (positive = early) */
  firstWordDevAvg: number;
  firstWordDevP50: number;
  /** % of cues that switch before last word spoken */
  prematureSwitchRate: number;
  /** Among premature switches, avg seconds cut off */
  prematureSwitchAvgSec: number;
  /** Per-cue details */
  details: CueSyncDetail[];
}

/** Parse ASR events from YouTube JSON, extracting word-level timing. */
export function parseAsrWords(jsonText: string): ASRWord[] {
  const data = JSON.parse(jsonText);
  const words: ASRWord[] = [];
  for (const event of data.events ?? []) {
    const segs = event.segs as { utf8: string; tOffsetMs?: number }[] | undefined;
    if (!segs) continue;
    const baseMs = (event.tStartMs as number) ?? 0;
    for (const seg of segs) {
      const w = seg.utf8.trim();
      if (!w || w === '\n') continue;
      words.push({ time: (baseMs + (seg.tOffsetMs ?? 0)) / 1000, word: w });
    }
  }
  return words;
}

const strip = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

/** Binary search: first ASR word index with time >= t */
function lowerBound(words: ASRWord[], t: number): number {
  let lo = 0,
    hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (words[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Score how well merged cues sync with ASR word-level timing.
 *
 * For each merged cue:
 *   - Match first/last words to ASR using time-based search
 *   - Measure lead time (cue start vs first word spoken)
 *   - Measure switch timing (does cue stay until speech ends?)
 *
 * Penalty model:
 *   - Late penalty:   firstWordDev < -0.3s → increasing penalty (heavy)
 *   - Early penalty:  firstWordDev > 1.0s  → mild penalty
 *   - Cutoff penalty: premature switch      → heavy penalty
 *   - Linger penalty: postSpeechBuffer > 2s → mild penalty
 */
export function scoreMerge(merged: SubtitleCue[], asrWords: ASRWord[]): SyncScore {
  const details: CueSyncDetail[] = [];

  for (let ci = 0; ci < merged.length; ci++) {
    const cue = merged[ci];
    const cueWords = cue.text.split(/\s+/).filter(Boolean);
    if (cueWords.length === 0) continue;

    const firstCueWord = strip(cueWords[0]);
    const lastCueWord = strip(cueWords[cueWords.length - 1]);

    // Time-based window search
    const windowStart = Math.max(0, cue.start - 2);
    const windowEnd = cue.start + cue.duration + 2;
    const startIdx = lowerBound(asrWords, windowStart);
    const endIdx = lowerBound(asrWords, windowEnd);
    if (startIdx >= asrWords.length) continue;

    // Find first word match
    let firstMatch = -1;
    for (let i = startIdx; i < Math.min(endIdx, asrWords.length); i++) {
      if (strip(asrWords[i].word) === firstCueWord) {
        firstMatch = i;
        break;
      }
    }
    if (firstMatch === -1) continue;

    // Find last word match
    let lastMatch = firstMatch;
    const searchEnd = Math.min(firstMatch + cueWords.length + 15, asrWords.length);
    for (let i = firstMatch; i < searchEnd; i++) {
      if (strip(asrWords[i].word) === lastCueWord) {
        lastMatch = i;
      }
    }

    // Switch time: when this cue gets replaced by the next one.
    // The overlay uses binary search: latest cue with start <= currentTime wins.
    // So when adjacent cues overlap (due to LEAD), the next cue takes over
    // at its start time — not at the current cue's end.
    const cueEnd = cue.start + cue.duration;
    const nextStart = ci < merged.length - 1 ? merged[ci + 1].start : Infinity;
    const switchTime = Math.min(cueEnd, nextStart);

    const firstWordTime = asrWords[firstMatch].time;
    const lastWordTime = asrWords[lastMatch].time;

    details.push({
      idx: ci,
      cueStart: cue.start,
      switchTime,
      firstWordTime,
      lastWordTime,
      leadTime: firstWordTime - cue.start,
      postSpeechBuffer: switchTime - lastWordTime,
    });
  }

  if (details.length === 0) {
    return {
      score: 0,
      matchRate: 0,
      firstWordDevAvg: 0,
      firstWordDevP50: 0,
      prematureSwitchRate: 0,
      prematureSwitchAvgSec: 0,
      details: [],
    };
  }

  // Per-cue component scoring (bounded 0-1)
  let totalScore = 0;
  let prematureSwitchCount = 0;
  let prematureSwitchTotal = 0;

  for (const d of details) {
    // Lead component (50%): how well does cue start match speech?
    // Ideal range: [-0.2, 0.6] — slightly before to a bit early
    let leadComponent: number;
    if (d.leadTime >= -0.2 && d.leadTime <= 0.6) {
      leadComponent = 1.0; // perfect range
    } else if (d.leadTime < -0.2) {
      // Late: degrade linearly, 0 at -1.5s late
      leadComponent = Math.max(0, 1 - Math.abs(d.leadTime + 0.2) * 0.77);
    } else {
      // Too early: degrade slowly, 0 at 3.0s early
      leadComponent = Math.max(0, 1 - (d.leadTime - 0.6) * 0.42);
    }

    // Switch component (50%): is the cue cut off before speech ends?
    let switchComponent: number;
    if (d.postSpeechBuffer >= 0) {
      // No premature switch
      // Mild penalty for excessive linger (> 2s)
      if (d.postSpeechBuffer <= 2.0) {
        switchComponent = 1.0;
      } else {
        switchComponent = Math.max(0.5, 1 - (d.postSpeechBuffer - 2.0) * 0.1);
      }
    } else {
      // Premature switch: degrade linearly, 0 at 2s cutoff
      switchComponent = Math.max(0, 1 - Math.abs(d.postSpeechBuffer) * 0.5);
      prematureSwitchCount++;
      prematureSwitchTotal += Math.abs(d.postSpeechBuffer);
    }

    totalScore += leadComponent * 0.5 + switchComponent * 0.5;
  }

  const score = totalScore / details.length;

  const leadTimes = details.map((d) => d.leadTime);
  const sorted = [...leadTimes].sort((a, b) => a - b);

  return {
    score,
    matchRate: details.length / merged.length,
    firstWordDevAvg: leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length,
    firstWordDevP50: sorted[Math.floor(sorted.length * 0.5)],
    prematureSwitchRate: prematureSwitchCount / details.length,
    prematureSwitchAvgSec:
      prematureSwitchCount > 0 ? prematureSwitchTotal / prematureSwitchCount : 0,
    details,
  };
}

/** Format a comparison row for parameter sweep output. */
export function formatScoreRow(label: string, s: SyncScore): string {
  return (
    `${label.padEnd(45)} ` +
    `score=${s.score.toFixed(3)}  ` +
    `lead=${s.firstWordDevAvg.toFixed(2)}s  ` +
    `p50=${s.firstWordDevP50.toFixed(2)}s  ` +
    `cutoff=${(s.prematureSwitchRate * 100).toFixed(0)}%/${s.prematureSwitchAvgSec.toFixed(2)}s  ` +
    `match=${(s.matchRate * 100).toFixed(0)}%`
  );
}
