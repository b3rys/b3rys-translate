import type { SubtitleCue } from '@/types';

/**
 * Timing quality metrics for subtitle parameter tuning.
 * Each metric returns a score 0..1 (1 = best).
 */

/** Korean reading speed: ~8.3 chars/sec. */
const KO_CPS = 8.3;

export interface TimingMetrics {
  readingScore: number;
  overlapScore: number;
  leadScore: number;
  retentionScore: number;
  gapScore: number;
}

export interface CompositeResult extends TimingMetrics {
  composite: number;
}

const WEIGHTS: TimingMetrics = {
  readingScore: 0.3,
  overlapScore: 0.25,
  leadScore: 0.2,
  retentionScore: 0.15,
  gapScore: 0.1,
};

/**
 * Reading score: is there enough display time to read the translation?
 * Estimates Korean translation length as ~1.2x English char count,
 * then checks if duration ≥ chars / KO_CPS.
 * Score = average of min(1, duration / requiredTime) across all cues.
 */
export function calcReadingScore(processed: SubtitleCue[]): number {
  if (processed.length === 0) return 1;
  let sum = 0;
  for (const c of processed) {
    const koChars = c.text.length * 1.2; // estimated Korean chars
    const required = koChars / KO_CPS;
    sum += Math.min(1, c.duration / required);
  }
  return sum / processed.length;
}

/**
 * Overlap score: penalizes overlap between adjacent cues.
 * Overlap > 0 means two subtitles are visible simultaneously.
 * Score = 1 - average(overlap / maxAcceptableOverlap) clamped to [0,1].
 * Max acceptable overlap: 1.5s (beyond this it's confusing).
 */
export function calcOverlapScore(processed: SubtitleCue[]): number {
  if (processed.length < 2) return 1;
  const MAX_OVERLAP = 1.5;
  let totalPenalty = 0;
  for (let i = 1; i < processed.length; i++) {
    const prevEnd = processed[i - 1].start + processed[i - 1].duration;
    const overlap = Math.max(0, prevEnd - processed[i].start);
    totalPenalty += Math.min(1, overlap / MAX_OVERLAP);
  }
  return 1 - totalPenalty / (processed.length - 1);
}

/**
 * Lead score: is the subtitle shown 0.1~0.6s before speech starts?
 * Compares processed start to raw start to measure actual lead applied.
 * Ideal lead: 0.1~0.6s. Too early or too late is penalized.
 */
export function calcLeadScore(processed: SubtitleCue[], raw: SubtitleCue[]): number {
  if (processed.length === 0 || raw.length === 0) return 1;

  const IDEAL_MIN = 0.1;
  const IDEAL_MAX = 0.6;

  // Match each processed cue to its closest raw cue by text overlap
  let sum = 0;
  let count = 0;
  for (const p of processed) {
    // Find raw cue whose start is closest to (processed.start + some lead)
    const firstWord = p.text.split(' ')[0].toLowerCase();
    const matchRaw = raw.find(
      (r) => r.text.toLowerCase().startsWith(firstWord) && Math.abs(r.start - p.start) < 3,
    );
    if (!matchRaw) continue;

    const lead = matchRaw.start - p.start;
    if (lead >= IDEAL_MIN && lead <= IDEAL_MAX) {
      sum += 1;
    } else if (lead >= 0) {
      // Outside ideal range but not negative
      const dist = lead < IDEAL_MIN ? IDEAL_MIN - lead : lead - IDEAL_MAX;
      sum += Math.max(0, 1 - dist / 0.5);
    } else {
      // Negative lead (subtitle appears after speech) — bad
      sum += Math.max(0, 1 + lead / 0.5);
    }
    count++;
  }

  return count > 0 ? sum / count : 0.5;
}

/**
 * Retention score: after speech ends, does the subtitle stay visible long enough?
 * Ideal retention: 0.1~0.5s beyond speech end.
 * Too short: viewer can't finish reading. Too long: stale text.
 */
export function calcRetentionScore(processed: SubtitleCue[], raw: SubtitleCue[]): number {
  if (processed.length === 0 || raw.length === 0) return 1;

  const IDEAL_MIN = 0.1;
  const IDEAL_MAX = 0.5;

  // Build a map of raw speech spans to compare with processed cue ends
  let sum = 0;
  let count = 0;
  for (const p of processed) {
    // Find raw cues that overlap with this processed cue
    const pEnd = p.start + p.duration;
    const overlapping = raw.filter((r) => {
      const rEnd = r.start + r.duration;
      return r.start < pEnd + 1 && rEnd > p.start - 1;
    });
    if (overlapping.length === 0) continue;

    const lastCoveredEnd = Math.max(...overlapping.map((r) => r.start + r.duration));
    const retention = pEnd - lastCoveredEnd;

    if (retention >= IDEAL_MIN && retention <= IDEAL_MAX) {
      sum += 1;
    } else if (retention >= 0) {
      const dist = retention < IDEAL_MIN ? IDEAL_MIN - retention : retention - IDEAL_MAX;
      sum += Math.max(0, 1 - dist / 0.5);
    } else {
      sum += Math.max(0, 1 + retention / 0.5);
    }
    count++;
  }

  return count > 0 ? sum / count : 0.5;
}

/**
 * Gap score: penalizes excessive gaps between adjacent cues.
 * Small gaps (< 0.3s) are fine (natural pause between sentences).
 * Large gaps (> 2s) mean the viewer sees nothing for too long.
 */
export function calcGapScore(processed: SubtitleCue[]): number {
  if (processed.length < 2) return 1;
  const MAX_GAP = 2.0;
  let totalPenalty = 0;
  let gapCount = 0;
  for (let i = 1; i < processed.length; i++) {
    const prevEnd = processed[i - 1].start + processed[i - 1].duration;
    const gap = processed[i].start - prevEnd;
    if (gap > 0.3) {
      totalPenalty += Math.min(1, (gap - 0.3) / MAX_GAP);
      gapCount++;
    }
  }
  if (gapCount === 0) return 1;
  return 1 - totalPenalty / (processed.length - 1);
}

/**
 * Weighted composite of all 5 metrics.
 */
export function compositeScore(metrics: TimingMetrics): number {
  return (
    metrics.readingScore * WEIGHTS.readingScore +
    metrics.overlapScore * WEIGHTS.overlapScore +
    metrics.leadScore * WEIGHTS.leadScore +
    metrics.retentionScore * WEIGHTS.retentionScore +
    metrics.gapScore * WEIGHTS.gapScore
  );
}

/**
 * Calculate all metrics at once.
 */
export function calcAllMetrics(processed: SubtitleCue[], raw: SubtitleCue[]): CompositeResult {
  const metrics: TimingMetrics = {
    readingScore: calcReadingScore(processed),
    overlapScore: calcOverlapScore(processed),
    leadScore: calcLeadScore(processed, raw),
    retentionScore: calcRetentionScore(processed, raw),
    gapScore: calcGapScore(processed),
  };
  return { ...metrics, composite: compositeScore(metrics) };
}

/**
 * Format a comparison table as ASCII for stdout.
 */
export function formatComparisonTable(rows: { label: string; result: CompositeResult }[]): string {
  const header =
    '| Label                          | Read  | Ovlap | Lead  | Retn  | Gap   | Score |';
  const sep = '|--------------------------------|-------|-------|-------|-------|-------|-------|';
  const lines = [header, sep];
  for (const { label, result } of rows) {
    const l = label.padEnd(30);
    const r = result.readingScore.toFixed(3);
    const o = result.overlapScore.toFixed(3);
    const le = result.leadScore.toFixed(3);
    const re = result.retentionScore.toFixed(3);
    const g = result.gapScore.toFixed(3);
    const c = result.composite.toFixed(3);
    lines.push(`| ${l} | ${r} | ${o} | ${le} | ${re} | ${g} | ${c} |`);
  }
  return lines.join('\n');
}
