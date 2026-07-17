import { describe, it, expect } from 'vitest';
import {
  stripTrailingFuncWords,
  splitCuesAtSentences,
  postProcessCues,
  mergeCues,
  mergeCuesTwoLine,
  refineForcedBreak,
  TRAILING_FUNC_WORDS,
} from '@/entrypoints/content/youtube/cue-merger';
import type { SubtitleCue } from '@/types';

describe('TRAILING_FUNC_WORDS', () => {
  it('contains common function words', () => {
    expect(TRAILING_FUNC_WORDS.has('the')).toBe(true);
    expect(TRAILING_FUNC_WORDS.has('is')).toBe(true);
    expect(TRAILING_FUNC_WORDS.has('would')).toBe(true);
  });

  it('does not contain content words', () => {
    expect(TRAILING_FUNC_WORDS.has('hello')).toBe(false);
    expect(TRAILING_FUNC_WORDS.has('computer')).toBe(false);
  });
});

describe('stripTrailingFuncWords', () => {
  it('strips trailing "the" from end', () => {
    const { flush, leftover } = stripTrailingFuncWords('learn together the', 5);
    expect(flush).toBe('learn together');
    expect(leftover).toBe('the');
  });

  it('strips a trailing preposition chain ("about the")', () => {
    // "about" needs an object — ending on it reads as badly as ending on "the"
    const { flush, leftover } = stripTrailingFuncWords('learn about the', 5);
    expect(flush).toBe('learn');
    expect(leftover).toBe('about the');
  });

  it('strips multiple trailing function words', () => {
    const { flush, leftover } = stripTrailingFuncWords('internship would have', 5);
    expect(flush).toBe('internship');
    expect(leftover).toBe('would have');
  });

  it('does not strip if flush would be too short', () => {
    const { flush, leftover } = stripTrailingFuncWords('I am the', 5);
    expect(flush).toBe('I am the');
    expect(leftover).toBe('');
  });

  it('handles text with no trailing function words', () => {
    const { flush, leftover } = stripTrailingFuncWords('hello world', 3);
    expect(flush).toBe('hello world');
    expect(leftover).toBe('');
  });

  it('handles contractions as function words', () => {
    const { flush, leftover } = stripTrailingFuncWords("and then we're", 5);
    expect(flush).toBe('and then');
    expect(leftover).toBe("we're");
  });
});

describe('splitCuesAtSentences', () => {
  it('splits cue at sentence boundary', () => {
    const cues: SubtitleCue[] = [
      { start: 0, duration: 4, text: 'First sentence. Second sentence starts here' },
    ];
    const result = splitCuesAtSentences(cues);
    expect(result.length).toBe(2);
    expect(result[0].text).toBe('First sentence.');
    expect(result[1].text).toBe('Second sentence starts here');
  });

  it('preserves abbreviations (Dr. Smith)', () => {
    const cues: SubtitleCue[] = [
      { start: 0, duration: 2, text: 'Dr. Smith said hello. Then he left' },
    ];
    const result = splitCuesAtSentences(cues);
    // Should split at "hello. Then" but NOT at "Dr."
    expect(result.length).toBe(2);
    expect(result[0].text).toContain('Dr. Smith');
    expect(result[0].text).toContain('hello.');
  });

  it('preserves dotted abbreviations (U.S.)', () => {
    const cues: SubtitleCue[] = [
      { start: 0, duration: 2, text: 'The U.S. government decided. People agreed' },
    ];
    const result = splitCuesAtSentences(cues);
    expect(result[0].text).toContain('U.S.');
  });

  it('preserves timing ratios when splitting', () => {
    const cues: SubtitleCue[] = [
      { start: 10, duration: 4, text: 'Short. Longer text here please' },
    ];
    const result = splitCuesAtSentences(cues);
    expect(result.length).toBe(2);
    // First part should start at original start
    expect(result[0].start).toBe(10);
    // Durations should sum to original (approximately)
    const totalDur = result.reduce((sum, c) => sum + c.duration, 0);
    expect(totalDur).toBeCloseTo(4, 1);
  });

  it('returns single cue unchanged when no split', () => {
    const cues: SubtitleCue[] = [{ start: 0, duration: 2, text: 'no sentence boundary here' }];
    const result = splitCuesAtSentences(cues);
    expect(result).toEqual(cues);
  });
});

describe('postProcessCues', () => {
  it('absorbs short orphan cue into previous', () => {
    const cues: SubtitleCue[] = [
      { start: 0, duration: 3, text: 'This is a longer first subtitle cue' },
      { start: 3, duration: 1, text: 'tiny' },
    ];
    const result = postProcessCues(cues, 85, 0);
    expect(result.length).toBe(1);
    expect(result[0].text).toContain('tiny');
  });

  it('applies LEAD timing to shift start earlier', () => {
    const cues: SubtitleCue[] = [{ start: 5, duration: 3, text: 'Hello world' }];
    const result = postProcessCues(cues, 85);
    // Start should be shifted earlier by LEAD
    expect(result[0].start).toBeLessThan(5);
  });

  it('splits oversized cue at conjunction', () => {
    const longText =
      'This is a very long subtitle that goes on and on because the speaker kept talking without any pause whatsoever';
    const cues: SubtitleCue[] = [{ start: 0, duration: 10, text: longText }];
    const result = postProcessCues(cues, 50);
    expect(result.length).toBeGreaterThan(1);
  });
});

describe('mergeCues', () => {
  it('returns empty array for empty input', () => {
    expect(mergeCues([])).toEqual([]);
  });

  it('merges short adjacent cues into one', () => {
    const cues: SubtitleCue[] = [
      { start: 0, duration: 1, text: 'hello' },
      { start: 1, duration: 1, text: 'world' },
      { start: 2, duration: 1, text: 'how' },
    ];
    const result = mergeCues(cues);
    // Short cues should be merged together
    expect(result.length).toBeLessThanOrEqual(cues.length);
    // Merged text should contain all original words
    const allText = result.map((c) => c.text).join(' ');
    expect(allText).toContain('hello');
    expect(allText).toContain('world');
  });

  it('splits at sentence endings', () => {
    const cues: SubtitleCue[] = [
      { start: 0, duration: 1, text: 'First sentence.' },
      { start: 1, duration: 1, text: 'Second one starts' },
    ];
    const result = mergeCues(cues);
    // Each sentence should be a separate chunk
    expect(result.some((c) => c.text.includes('First sentence.'))).toBe(true);
  });

  it('respects MAX_CHARS limit (80)', () => {
    const cues: SubtitleCue[] = Array.from({ length: 20 }, (_, i) => ({
      start: i,
      duration: 1,
      text: 'word'.repeat(5) + ' ',
    }));
    const result = mergeCues(cues);
    // No merged cue should exceed ~85 chars (80 + post-processing tolerance)
    for (const cue of result) {
      expect(cue.text.length).toBeLessThan(100);
    }
  });

  it('does not end a limit-forced chunk on a trailing function word', () => {
    const cues: SubtitleCue[] = [
      { start: 0, duration: 2, text: 'we always recommend bringing extra' },
      { start: 2, duration: 1, text: 'printed copies of your' },
      { start: 3, duration: 2, text: 'resume before every interview session' },
    ];
    const result = mergeCues(cues);
    // Forced flush would raw-cut at "...copies of your |" — refinement moves
    // the dependent words into the next chunk.
    expect(result[0].text).toBe('we always recommend bringing extra printed copies');
    expect(result[1].text).toContain('of your resume');
  });

  it('prefers a comma break when a limit-forced flush happens', () => {
    const cues: SubtitleCue[] = [
      { start: 0, duration: 2, text: 'when you finally walk into the interview room,' },
      { start: 2, duration: 1, text: 'please bring several printed copies' },
      { start: 3, duration: 2, text: 'along with a fully charged laptop for notes' },
    ];
    const result = mergeCues(cues);
    expect(result[0].text).toBe('when you finally walk into the interview room,');
    expect(result[1].text).toContain('please bring several printed copies');
  });
});

describe('refineForcedBreak', () => {
  it('keeps text ending in punctuation unchanged (already natural)', () => {
    const { flush, leftover } = refineForcedBreak('a clause that ends with a comma,', {
      minFlush: 10,
      minLeftover: 5,
    });
    expect(flush).toBe('a clause that ends with a comma,');
    expect(leftover).toBe('');
  });

  it('breaks at the comma nearest the middle', () => {
    const { flush, leftover } = refineForcedBreak(
      'after the meeting ended, everyone went home to rest',
      { minFlush: 10, minLeftover: 5 },
    );
    expect(flush).toBe('after the meeting ended,');
    expect(leftover).toBe('everyone went home to rest');
  });

  it('falls back to function-word stripping when no comma qualifies', () => {
    const { flush, leftover } = refineForcedBreak('the interviewer asked about the', {
      minFlush: 10,
      minLeftover: 2,
    });
    expect(flush).toBe('the interviewer asked');
    expect(leftover).toBe('about the');
  });

  it('returns text as-is when no refiner has a proposal', () => {
    const { flush, leftover } = refineForcedBreak('short plain words here', {
      minFlush: 20,
      minLeftover: 10,
    });
    expect(flush).toBe('short plain words here');
    expect(leftover).toBe('');
  });
});

describe('mergeCuesTwoLine', () => {
  it('returns empty array for empty input', () => {
    expect(mergeCuesTwoLine([])).toEqual([]);
  });

  it('accumulates until TARGET_MIN (70) before accepting breaks', () => {
    const cues: SubtitleCue[] = [
      { start: 0, duration: 2, text: 'Short.' },
      { start: 2, duration: 2, text: 'Also short.' },
    ];
    const result = mergeCuesTwoLine(cues);
    // Combined length is < 70, so they should be merged
    expect(result.length).toBe(1);
  });
});
