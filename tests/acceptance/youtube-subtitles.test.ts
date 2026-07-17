import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSubtitleResponse } from '@/entrypoints/content/youtube/subtitle-fetcher';
import {
  mergeCues,
  mergeCuesTwoLine,
  postProcessCues,
} from '@/entrypoints/content/youtube/cue-merger';

function loadJsonFixture(name: string): string {
  return readFileSync(join(__dirname, '..', 'fixtures', name), 'utf-8');
}

// ============================================================
// ASR fixture: bTQM3oEW0gk
// ============================================================

describe('YouTube ASR — bTQM3oEW0gk', () => {
  const getCues = () =>
    parseSubtitleResponse(loadJsonFixture('youtube-timedtext-asr-bTQM3oEW0gk.json'));

  it('parses events into cues', () => {
    const cues = getCues();
    expect(cues.length).toBeGreaterThan(10);
    expect(cues[0]).toHaveProperty('start');
    expect(cues[0]).toHaveProperty('duration');
    expect(cues[0]).toHaveProperty('text');
  });

  it('cue timing is in seconds (not ms)', () => {
    const cues = getCues();
    // timedtext JSON uses ms; parsed values should be seconds
    expect(cues[0].start).toBeLessThan(10000);
    expect(cues[0].duration).toBeLessThan(10000);
  });

  it('mergeCues produces merged chunks', () => {
    const cues = getCues();
    const merged = mergeCues(cues);
    expect(merged.length).toBeGreaterThan(0);
    expect(merged.length).toBeLessThan(cues.length);
  });

  it('merged cues have reasonable text length', () => {
    const cues = getCues();
    const merged = mergeCues(cues);
    for (const cue of merged) {
      expect(cue.text.length).toBeGreaterThan(0);
      expect(cue.text.length).toBeLessThan(200);
    }
  });

  it('merged cues maintain chronological order', () => {
    const cues = getCues();
    const merged = mergeCues(cues);
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].start).toBeGreaterThanOrEqual(merged[i - 1].start);
    }
  });

  it('mergeCuesTwoLine also produces valid output', () => {
    const cues = getCues();
    const merged = mergeCuesTwoLine(cues);
    expect(merged.length).toBeGreaterThan(0);
    expect(merged.length).toBeLessThan(cues.length);
  });

  it('ASR dynamic LEAD is applied — first merged cue starts before first raw cue', () => {
    const cues = getCues();
    const merged = mergeCues(cues);
    // Dynamic LEAD (cps * 0.03, clamped 0.2~0.8) pulls start earlier
    // The first merged cue's text starts with the first raw cue's text
    const firstRaw = cues[0];
    expect(merged[0].start).toBeLessThan(firstRaw.start);
  });

  it('ASR merged cue end extends past raw speech end (LEAD_PAD evidence)', () => {
    const cues = getCues();
    const merged = mergeCues(cues);
    // LEAD_PAD=0.3s extends the end time past raw speech end
    // Check a sample of merged cues: their end should exceed the start + original span
    const lastRaw = cues[cues.length - 1];
    const lastRawEnd = lastRaw.start + lastRaw.duration;
    const lastMerged = merged[merged.length - 1];
    const lastMergedEnd = lastMerged.start + lastMerged.duration;
    // LEAD_PAD should extend the last cue's end past the raw speech end
    expect(lastMergedEnd).toBeGreaterThan(lastRawEnd);
  });
});

// ============================================================
// ASR fixture: AUcYJczWXT4
// ============================================================

describe('YouTube ASR — AUcYJczWXT4', () => {
  const getCues = () =>
    parseSubtitleResponse(loadJsonFixture('youtube-timedtext-asr-AUcYJczWXT4.json'));

  it('parses events into cues', () => {
    const cues = getCues();
    expect(cues.length).toBeGreaterThan(10);
  });

  it('mergeCues produces merged chunks', () => {
    const cues = getCues();
    const merged = mergeCues(cues);
    expect(merged.length).toBeGreaterThan(0);
    expect(merged.length).toBeLessThan(cues.length);
  });

  it('merged cues have reasonable text length', () => {
    const cues = getCues();
    const merged = mergeCues(cues);
    for (const cue of merged) {
      expect(cue.text.length).toBeGreaterThan(0);
      expect(cue.text.length).toBeLessThan(200);
    }
  });

  it('merged cues maintain chronological order', () => {
    const cues = getCues();
    const merged = mergeCues(cues);
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].start).toBeGreaterThanOrEqual(merged[i - 1].start);
    }
  });

  it('ASR dynamic LEAD is applied — first merged cue starts before first raw cue', () => {
    const cues = getCues();
    const merged = mergeCues(cues);
    const firstRaw = cues[0];
    expect(merged[0].start).toBeLessThan(firstRaw.start);
  });
});

// ============================================================
// Manual fixture: tnsrnsy_Lus
// ============================================================

describe('YouTube Manual — tnsrnsy_Lus', () => {
  const getCues = () =>
    parseSubtitleResponse(loadJsonFixture('youtube-timedtext-manual-tnsrnsy_Lus.json'));

  it('parses events into cues', () => {
    const cues = getCues();
    expect(cues.length).toBeGreaterThan(10);
  });

  it('manual cues have longer text than ASR fragments', () => {
    const cues = getCues();
    const avgLen = cues.reduce((sum, c) => sum + c.text.length, 0) / cues.length;
    // Manual subtitles are sentence-level, typically > 20 chars average
    expect(avgLen).toBeGreaterThan(20);
  });

  it('postProcessCues produces valid output', () => {
    const cues = getCues();
    const processed = postProcessCues(cues, 85, 0.1);
    expect(processed.length).toBeGreaterThan(0);
  });

  it('postProcessCues maintains chronological order', () => {
    const cues = getCues();
    const processed = postProcessCues(cues, 85, 0.1);
    for (let i = 1; i < processed.length; i++) {
      expect(processed[i].start).toBeGreaterThanOrEqual(processed[i - 1].start);
    }
  });

  it('postProcessCues text length stays within display limits', () => {
    const cues = getCues();
    const processed = postProcessCues(cues, 85, 0.1);
    for (const cue of processed) {
      expect(cue.text.length).toBeLessThan(200);
    }
  });

  it('manual cues may contain newlines (two-line format)', () => {
    const cues = getCues();
    const hasNewlines = cues.some((c) => c.text.includes('\n'));
    // Manual subtitles often have \n for two-line display
    expect(hasNewlines).toBe(true);
  });

  it('manual LEAD ≈ 0.1s — first cue start pulled earlier', () => {
    const cues = getCues();
    const processed = postProcessCues(cues, 85, 0.1);
    // Manual lead=0.1s: first processed cue should start ~0.1s before first raw cue
    const diff = cues[0].start - processed[0].start;
    expect(diff).toBeCloseTo(0.1, 1); // within 0.05
  });

  it('LEAD + LEAD_PAD increase total display time', () => {
    const cues = getCues();
    const processed = postProcessCues(cues, 85, 0.1);
    // LEAD (0.1) + LEAD_PAD (0.3) add ~0.4s per cue to total display time
    const rawTotal = cues.reduce((sum, c) => sum + c.duration, 0);
    const processedTotal = processed.reduce((sum, c) => sum + c.duration, 0);
    expect(processedTotal).toBeGreaterThan(rawTotal);
  });
});
