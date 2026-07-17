import { describe, it, expect } from 'vitest';
import type { SubtitleCue } from '@/types';
import {
  calcReadingScore,
  calcOverlapScore,
  calcLeadScore,
  calcRetentionScore,
  calcGapScore,
  compositeScore,
  calcAllMetrics,
  formatComparisonTable,
} from './helpers/timing-metrics';

// Helper to create cues quickly
function cue(start: number, duration: number, text: string): SubtitleCue {
  return { start, duration, text };
}

describe('calcReadingScore', () => {
  it('returns 1.0 for empty input', () => {
    expect(calcReadingScore([])).toBe(1);
  });

  it('returns high score when display time is ample', () => {
    // 10 chars * 1.2 = 12 Korean chars, needs 12/8.3 ≈ 1.45s, has 5s
    const cues = [cue(0, 5, 'Hello World')];
    expect(calcReadingScore(cues)).toBeGreaterThan(0.9);
  });

  it('returns lower score when display time is tight', () => {
    // 50 chars * 1.2 = 60 Korean chars, needs 60/8.3 ≈ 7.2s, has only 2s
    const cues = [cue(0, 2, 'This is a very long subtitle text that needs time')];
    expect(calcReadingScore(cues)).toBeLessThan(0.5);
  });

  it('score is proportional to duration sufficiency', () => {
    const short = [cue(0, 1, 'Hello World')];
    const long = [cue(0, 5, 'Hello World')];
    expect(calcReadingScore(long)).toBeGreaterThan(calcReadingScore(short));
  });
});

describe('calcOverlapScore', () => {
  it('returns 1.0 for single cue', () => {
    expect(calcOverlapScore([cue(0, 3, 'A')])).toBe(1);
  });

  it('returns 1.0 for non-overlapping cues', () => {
    const cues = [cue(0, 2, 'A'), cue(3, 2, 'B'), cue(6, 2, 'C')];
    expect(calcOverlapScore(cues)).toBe(1);
  });

  it('penalizes overlapping cues', () => {
    // Cue A ends at 3, Cue B starts at 2 → 1s overlap
    const cues = [cue(0, 3, 'A'), cue(2, 3, 'B')];
    expect(calcOverlapScore(cues)).toBeLessThan(1);
    expect(calcOverlapScore(cues)).toBeGreaterThan(0);
  });

  it('heavy overlap yields low score', () => {
    // 1.5s overlap (max penalty threshold)
    const cues = [cue(0, 4, 'A'), cue(2.5, 4, 'B')];
    expect(calcOverlapScore(cues)).toBeLessThanOrEqual(0.1);
  });
});

describe('calcLeadScore', () => {
  it('returns 1.0 when lead is in ideal range (0.1-0.6s)', () => {
    const raw = [cue(1.0, 3, 'Hello world')];
    const processed = [cue(0.7, 3.3, 'Hello world')]; // 0.3s lead
    expect(calcLeadScore(processed, raw)).toBeGreaterThan(0.9);
  });

  it('penalizes zero lead', () => {
    const raw = [cue(1.0, 3, 'Hello world')];
    const processed = [cue(1.0, 3, 'Hello world')]; // 0s lead
    expect(calcLeadScore(processed, raw)).toBeLessThan(1.0);
  });

  it('penalizes excessive lead (>0.6s)', () => {
    const raw = [cue(2.0, 3, 'Hello world')];
    const processed = [cue(0.5, 4.5, 'Hello world')]; // 1.5s lead
    expect(calcLeadScore(processed, raw)).toBeLessThan(0.5);
  });
});

describe('calcRetentionScore', () => {
  it('scores well for 0.3s retention', () => {
    const raw = [cue(1.0, 3, 'Hello world')];
    // processed ends at 1.0 + 3.3 = 4.3, raw ends at 4.0 → 0.3s retention
    const processed = [cue(0.7, 3.6, 'Hello world')];
    expect(calcRetentionScore(processed, raw)).toBeGreaterThan(0.8);
  });

  it('penalizes negative retention (cue disappears before speech ends)', () => {
    const raw = [cue(1.0, 5, 'Hello world')];
    // processed ends at 1.0 + 3 = 4.0, raw ends at 6.0 → -2s retention
    const processed = [cue(1.0, 3, 'Hello world')];
    expect(calcRetentionScore(processed, raw)).toBeLessThan(0.5);
  });
});

describe('calcGapScore', () => {
  it('returns 1.0 for no gaps', () => {
    // Cues abut: A ends at 3, B starts at 3
    const cues = [cue(0, 3, 'A'), cue(3, 3, 'B')];
    expect(calcGapScore(cues)).toBe(1);
  });

  it('returns 1.0 for small gaps (<= 0.3s)', () => {
    const cues = [cue(0, 3, 'A'), cue(3.2, 3, 'B')];
    expect(calcGapScore(cues)).toBe(1);
  });

  it('penalizes large gaps', () => {
    // 3s gap after 0.3 threshold = 2.7s gap / 2.0 max
    const cues = [cue(0, 3, 'A'), cue(6, 3, 'B')];
    expect(calcGapScore(cues)).toBeLessThan(1);
  });
});

describe('compositeScore', () => {
  it('returns weighted sum of metrics', () => {
    const metrics = {
      readingScore: 1.0,
      overlapScore: 1.0,
      leadScore: 1.0,
      retentionScore: 1.0,
      gapScore: 1.0,
    };
    expect(compositeScore(metrics)).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for all-zero metrics', () => {
    const metrics = {
      readingScore: 0,
      overlapScore: 0,
      leadScore: 0,
      retentionScore: 0,
      gapScore: 0,
    };
    expect(compositeScore(metrics)).toBe(0);
  });

  it('weights reading score highest (0.3)', () => {
    const onlyReading = {
      readingScore: 1.0,
      overlapScore: 0,
      leadScore: 0,
      retentionScore: 0,
      gapScore: 0,
    };
    expect(compositeScore(onlyReading)).toBeCloseTo(0.3, 5);
  });
});

describe('calcAllMetrics', () => {
  it('returns all 5 metrics plus composite', () => {
    const raw = [cue(1, 3, 'Hello world'), cue(5, 3, 'Next sentence')];
    const processed = [cue(0.7, 3.6, 'Hello world'), cue(4.7, 3.6, 'Next sentence')];
    const result = calcAllMetrics(processed, raw);
    expect(result).toHaveProperty('readingScore');
    expect(result).toHaveProperty('overlapScore');
    expect(result).toHaveProperty('leadScore');
    expect(result).toHaveProperty('retentionScore');
    expect(result).toHaveProperty('gapScore');
    expect(result).toHaveProperty('composite');
    expect(result.composite).toBeGreaterThan(0);
    expect(result.composite).toBeLessThanOrEqual(1);
  });
});

describe('formatComparisonTable', () => {
  it('produces readable ASCII table', () => {
    const rows = [
      {
        label: 'baseline',
        result: {
          readingScore: 0.85,
          overlapScore: 0.72,
          leadScore: 0.91,
          retentionScore: 0.65,
          gapScore: 0.88,
          composite: 0.81,
        },
      },
    ];
    const table = formatComparisonTable(rows);
    expect(table).toContain('baseline');
    expect(table).toContain('0.850');
    expect(table).toContain('Score');
  });
});
