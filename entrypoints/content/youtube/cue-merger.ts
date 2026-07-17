import type { SubtitleCue } from '@/types';

/**
 * Words that should never end a subtitle chunk — they grammatically
 * depend on the following word(s). Contractions (e.g. we're, don't)
 * are caught separately via apostrophe detection.
 */
export const TRAILING_FUNC_WORDS = new Set([
  // articles
  'the',
  'a',
  'an',
  // subject/object pronouns
  'i',
  'we',
  'you',
  'he',
  'she',
  'it',
  'they',
  'me',
  'us',
  'him',
  'her',
  'them',
  // possessive determiners
  'my',
  'our',
  'your',
  'his',
  'its',
  'their',
  // demonstratives
  'this',
  'that',
  'these',
  'those',
  // prepositions (need object)
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'with',
  'from',
  'by',
  'about',
  'into',
  'onto',
  'over',
  'under',
  'through',
  'between',
  'during',
  'against',
  'without',
  'upon',
  'than',
  // be-verbs (need complement)
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  // auxiliaries (need main verb)
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  // modals (need main verb)
  'will',
  'would',
  'could',
  'should',
  'can',
  'may',
  'might',
  'must',
  'shall',
  // adverbs (modify next word)
  'very',
  'really',
  'almost',
  'just',
  'even',
  'quite',
  'also',
  'too',
  'only',
  'still',
  // negation
  'not',
  'no',
  // conjunctions (need following clause)
  'so',
  'and',
  'but',
  'or',
  'nor',
  'because',
  'if',
  'when',
  'while',
  'whether',
]);

/**
 * Strip consecutive trailing function words from text.
 * E.g. "internship would have" → flush "internship", leftover "would have".
 * Handles punctuation: "it," is recognized as "it" (function word) + comma.
 */
export function stripTrailingFuncWords(
  text: string,
  minFlushLen: number,
): { flush: string; leftover: string } {
  let end = text.length;
  while (end > 0) {
    const spaceIdx = text.lastIndexOf(' ', end - 1);
    if (spaceIdx < minFlushLen) break;
    const word = text.substring(spaceIdx + 1, end);
    const clean = word.replace(/[^a-zA-Z']/g, '').toLowerCase();
    if (clean && (TRAILING_FUNC_WORDS.has(clean) || /'/.test(word))) {
      end = spaceIdx;
    } else {
      break;
    }
  }
  if (end < text.length) {
    return { flush: text.substring(0, end).trim(), leftover: text.substring(end).trim() };
  }
  return { flush: text, leftover: '' };
}

// --- Forced-break refinement ---
// When a chunk is flushed because it hit a hard limit (chars/time) rather than a
// natural boundary, the raw cut can land on a word that grammatically leans on
// what follows ("...multiple copies of your |"). A BreakRefiner proposes a more
// natural split of the accumulated text. Refiners are tried in priority order and
// the first proposal wins — new heuristics slot in without touching the merge loop.

export interface RefineOptions {
  minFlush: number; // smallest acceptable prefix (chars)
  minLeftover: number; // smallest acceptable remainder (chars)
}

export type BreakRefiner = (
  text: string,
  opts: RefineOptions,
) => { flush: string; leftover: string } | null;

/** Prefer the comma nearest the middle — clauses read as complete units. */
export const commaBreakRefiner: BreakRefiner = (text, opts) => {
  const mid = text.length / 2;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ',') continue;
    const pos = i + 1;
    if (pos < opts.minFlush || text.length - pos < opts.minLeftover) continue;
    const dist = Math.abs(pos - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = pos;
    }
  }
  if (best < 0) return null;
  return { flush: text.substring(0, best).trim(), leftover: text.substring(best).trim() };
};

/** Never end a chunk on a word that depends on the next one (articles, prepositions…). */
export const funcWordBreakRefiner: BreakRefiner = (text, opts) => {
  const { flush, leftover } = stripTrailingFuncWords(text, opts.minFlush);
  return leftover ? { flush, leftover } : null;
};

const FORCED_BREAK_REFINERS: BreakRefiner[] = [commaBreakRefiner, funcWordBreakRefiner];

/** Cue-boundary cuts that already land on punctuation need no refinement. */
const ENDS_NATURALLY_RE = /[,;:.!?]$/;

/**
 * Refine a forced (limit-triggered) break point.
 * Falls back to the raw text when no refiner has a better proposal.
 */
export function refineForcedBreak(
  text: string,
  opts: RefineOptions,
  refiners: BreakRefiner[] = FORCED_BREAK_REFINERS,
): { flush: string; leftover: string } {
  if (!ENDS_NATURALLY_RE.test(text)) {
    for (const refine of refiners) {
      const result = refine(text, opts);
      if (result) return result;
    }
  }
  return { flush: text, leftover: '' };
}

/**
 * Known abbreviations — protect their periods from sentence-boundary splitting.
 * ABBREV_RE: title/suffix abbreviations (Dr., Mr., etc.)
 * DOTTED_ABBREV_RE: dotted acronyms (U.S., e.g., etc.)
 */
const ABBREV_RE = /\b(Dr|Mr|Mrs|Ms|St|Jr|Sr|vs|etc|Prof|Gen|Gov|Inc|Corp|Ltd|Rev|Sgt|Capt|Col)\./gi;
const DOTTED_ABBREV_RE = /\b(U\.S|U\.K|U\.N|e\.g|i\.e|a\.m|p\.m)\b/gi;
const ABBREV_PH = '##ABBR##';
const DOTTED_PH = '##DOTD##';

/**
 * Pre-split: break each cue at sentence boundaries.
 * Handles . ! ? ; : followed by whitespace + uppercase letter.
 * Protects known abbreviations from false splits.
 */
export function splitCuesAtSentences(cues: SubtitleCue[]): SubtitleCue[] {
  const result: SubtitleCue[] = [];
  for (const cue of cues) {
    // Protect abbreviations by replacing their periods with placeholders
    let text = cue.text;
    const abbrMatches: string[] = [];
    text = text.replace(ABBREV_RE, (m) => {
      abbrMatches.push(m);
      return ABBREV_PH;
    });
    const dottedMatches: string[] = [];
    text = text.replace(DOTTED_ABBREV_RE, (m) => {
      dottedMatches.push(m);
      return DOTTED_PH;
    });

    const parts = text.split(/(?<=[.!?;:])\s+(?=[A-Z])/);

    // Restore abbreviations in each part
    const restored = parts.map((part) => {
      let aIdx = 0;
      let dIdx = 0;
      part = part.replace(/##ABBR##/g, () => abbrMatches[aIdx++] ?? '');
      part = part.replace(/##DOTD##/g, () => dottedMatches[dIdx++] ?? '');
      return part;
    });

    if (restored.length <= 1) {
      result.push(cue);
      continue;
    }
    const totalLen = restored.reduce((sum, p) => sum + p.length, 0);
    let offset = 0;
    for (const part of restored) {
      const ratio = part.length / totalLen;
      result.push({
        start: cue.start + offset,
        duration: cue.duration * ratio,
        text: part.trim(),
      });
      offset += cue.duration * ratio;
    }
  }
  return result;
}

/** Tunable timing parameters for postProcessCues and mergeCues. */
export interface PostProcessConfig {
  leadPad?: number; // extra padding after speech ends (default 0.3)
  leadCoeff?: number; // ASR dynamic LEAD coefficient (default 0.03)
  leadMin?: number; // ASR LEAD lower bound in seconds (default 0.2)
  leadMax?: number; // ASR LEAD upper bound in seconds (default 0.8)
  // Merge boundary parameters (used by mergeCues)
  maxTime?: number; // max chunk duration in seconds (default 5)
  maxChars?: number; // max chunk character count (default 80)
  clauseMinTime?: number; // min time before conjunction split (default 3)
  clauseMinChars?: number; // min chars before conjunction split (default 60)
}

/**
 * Shared post-processing: orphan absorption, oversized split, LEAD, duration chain.
 * Used by both heuristic mergeCues() and LLM semanticMergeCues().
 */
export function postProcessCues(
  cues: SubtitleCue[],
  displayMax = 85,
  lead?: number,
  config?: PostProcessConfig,
): SubtitleCue[] {
  const merged = [...cues];

  // Absorb short orphan cues (< 25 chars) into previous cue
  const MIN_CHARS = 25;
  const absorbOrphans = () => {
    for (let i = merged.length - 1; i > 0; i--) {
      if (merged[i].text.length < MIN_CHARS) {
        const combined = merged[i - 1].text + ' ' + merged[i].text;
        if (combined.length > displayMax) continue; // don't re-create oversized cues
        merged[i - 1].text = combined;
        merged[i - 1].duration = merged[i].start + merged[i].duration - merged[i - 1].start;
        merged.splice(i, 1);
      }
    }
  };
  absorbOrphans();

  // Split oversized cues: sentence boundary → conjunction → comma
  // displayMax passed as parameter (95 for 1-line, 160 for 2-line)
  const SENT_SPLIT = /[.!?]\s+(?=[A-Z])/g;
  const SPLIT_CONJ =
    /\s+(?=(and|but|so|if|or|that|which|where|when|because|while|since|although|however|before|after)\b)/i;
  for (let i = 0; i < merged.length; i++) {
    if (merged[i].text.length <= displayMax) continue;

    const text = merged[i].text;
    const mid = text.length / 2;

    let bestPos = -1;
    let bestDist = Infinity;
    let match;

    // Tier 0: sentence boundaries (. ! ? followed by space + uppercase)
    const sentRe = new RegExp(SENT_SPLIT.source, 'g');
    while ((match = sentRe.exec(text)) !== null) {
      const pos = match.index + match[0].indexOf(' ') + 1; // split after punctuation + space
      if (pos < 10 || pos > text.length - 10) continue;
      const dist = Math.abs(pos - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestPos = pos;
      }
    }

    // Tier 1: conjunctions
    if (bestPos === -1) {
      const re = new RegExp(SPLIT_CONJ.source, 'gi');
      while ((match = re.exec(text)) !== null) {
        if (match.index < 10 || match.index > text.length - 10) continue;
        const dist = Math.abs(match.index - mid);
        if (dist < bestDist) {
          bestDist = dist;
          bestPos = match.index;
        }
      }
    }

    // Tier 2: commas
    if (bestPos === -1) {
      for (let j = 0; j < text.length; j++) {
        if (text[j] === ',') {
          const pos = j + 1;
          if (pos < 10 || pos > text.length - 10) continue;
          const dist = Math.abs(pos - mid);
          if (dist < bestDist) {
            bestDist = dist;
            bestPos = pos;
          }
        }
      }
    }

    // Tier 3: last resort — nearest space to middle
    if (bestPos === -1) {
      for (let j = 0; j < text.length; j++) {
        if (text[j] === ' ') {
          if (j < 15 || j > text.length - 15) continue;
          const dist = Math.abs(j - mid);
          if (dist < bestDist) {
            bestDist = dist;
            bestPos = j;
          }
        }
      }
    }

    if (bestPos > 0) {
      const left = text.substring(0, bestPos).trim();
      const right = text.substring(bestPos).trim();
      const ratio = left.length / text.length;
      const orig = merged[i];
      merged.splice(
        i,
        1,
        {
          start: orig.start,
          duration: orig.duration * ratio,
          text: left,
        },
        {
          start: orig.start + orig.duration * ratio,
          duration: orig.duration * (1 - ratio),
          text: right,
        },
      );
      i--;
    }
  }

  // Second orphan pass: splitting may create new short chunks
  absorbOrphans();

  // LEAD: show subtitle early, but keep it on screen until speech ends.
  // No duration chain — gaps during silence are natural (like YouTube's own CC).
  // Dynamic LEAD based on speech density (words/sec): fast speech → more lead.
  const leadPad = config?.leadPad ?? 0.3;
  const leadCoeff = config?.leadCoeff ?? 0.03;
  const leadMin = config?.leadMin ?? 0.2;
  const leadMax = config?.leadMax ?? 0.8;

  // Track original speech end before LEAD modification (for overlap prevention)
  const speechEnds: number[] = merged.map((c) => c.start + c.duration);

  // Gap-aware LEAD: cap lead to the silence gap before each cue.
  // This prevents premature switching: for continuous speech (gap≈0), lead≈0
  // so cue appears exactly when speech starts. For cues after silence, full LEAD
  // is applied so subtitle appears early (user preference: slightly early > late).
  for (let i = 0; i < merged.length; i++) {
    const c = merged[i];
    let l: number;
    if (lead !== undefined) {
      l = lead;
    } else {
      const cps = c.duration > 0 ? c.text.length / c.duration : 15;
      l = Math.min(leadMax, Math.max(leadMin, cps * leadCoeff));
    }

    // Cap LEAD to the gap before this cue's speech to prevent premature
    // switching of the previous cue. merged[i].start is still the original
    // start at this point (hasn't been modified yet in this forward loop).
    if (i > 0) {
      const gap = c.start - speechEnds[i - 1];
      if (gap < l) {
        l = Math.max(0, gap); // cap LEAD to gap; if gap < 0 (overlap), LEAD = 0
      }
    }

    const origEnd = c.start + c.duration;
    c.start = Math.max(0, c.start - l);
    c.duration = origEnd + leadPad - c.start;
  }

  // Store original speech end on each cue (informational).
  for (let i = 0; i < merged.length; i++) {
    merged[i].speechEnd = speechEnds[i];
  }

  return merged;
}

/**
 * Remove timing overlaps from sequential cues.
 * YouTube ASR events can overlap (event i's end > event i+1's start).
 * We cap each cue's duration so it ends when the next cue starts,
 * ensuring clean, non-overlapping boundaries for merging and LEAD.
 */
function deoverlapCues(cues: SubtitleCue[]): SubtitleCue[] {
  return cues.map((c, i) => {
    if (i < cues.length - 1) {
      const maxDur = cues[i + 1].start - c.start;
      if (maxDur > 0 && c.duration > maxDur) {
        return { ...c, duration: maxDur };
      }
    }
    return c;
  });
}

/**
 * Merge cues into short, single-line chunks.
 * Always splits at original cue boundaries — never mid-text — to preserve
 * the precise word-level timing from ASR speech recognition.
 */
export function mergeCues(cues: SubtitleCue[], config?: PostProcessConfig): SubtitleCue[] {
  if (cues.length === 0) return [];

  const split = splitCuesAtSentences(deoverlapCues(cues));

  const MAX_TIME = config?.maxTime ?? 5;
  const MAX_CHARS = config?.maxChars ?? 80;
  const CLAUSE_MIN_TIME = config?.clauseMinTime ?? 3;
  const CLAUSE_MIN_CHARS = config?.clauseMinChars ?? 60;
  const CLAUSE_RE =
    /^(and|but|so|however|because|or|that|who|which|where|when|although|while|since|if|unless|before|after|whereas|until|whether|then|yet|nor|still|meanwhile|furthermore|moreover|nevertheless|therefore|thus|instead|otherwise)\b/i;

  const merged: SubtitleCue[] = [];
  let chunk: SubtitleCue[] = [];

  function flush() {
    if (chunk.length === 0) return;
    const text = chunk
      .map((c) => c.text)
      .join(' ')
      .trim();
    if (!text) {
      chunk = [];
      return;
    }
    const last = chunk[chunk.length - 1];
    merged.push({
      start: chunk[0].start,
      duration: last.start + last.duration - chunk[0].start,
      text,
    });
    chunk = [];
  }

  /**
   * Forced flush (char/time limit hit — not a natural boundary): refine the
   * break so the chunk doesn't end mid-phrase. The leftover seeds the next
   * chunk with proportional timing (same trade-off as postProcessCues splits).
   */
  function flushForced() {
    if (chunk.length === 0) return;
    const text = chunk
      .map((c) => c.text)
      .join(' ')
      .trim();
    const { flush: head, leftover } = refineForcedBreak(text, {
      minFlush: 25,
      minLeftover: 10,
    });
    if (!leftover) {
      flush();
      return;
    }
    const start = chunk[0].start;
    const last = chunk[chunk.length - 1];
    const end = last.start + last.duration;
    const headEnd = start + (end - start) * (head.length / text.length);
    merged.push({ start, duration: headEnd - start, text: head });
    chunk = [{ start: headEnd, duration: end - headEnd, text: leftover }];
  }

  for (const cue of split) {
    if (chunk.length > 0) {
      const text = chunk
        .map((c) => c.text)
        .join(' ')
        .trim();
      const elapsed = cue.start - chunk[0].start;

      // Split at conjunction if chunk is already substantial
      if (
        (elapsed >= CLAUSE_MIN_TIME || text.length >= CLAUSE_MIN_CHARS) &&
        CLAUSE_RE.test(cue.text.trim())
      ) {
        flush();
      }

      // Check if adding this cue would exceed char/time limits
      if (chunk.length > 0) {
        const wouldBe = text + ' ' + cue.text.trim();
        const wouldElapse = cue.start + cue.duration - chunk[0].start;
        if (wouldBe.length >= MAX_CHARS || wouldElapse >= MAX_TIME) {
          flushForced();
        }
      }
    }

    chunk.push(cue);

    // Split at sentence end
    if (/[.!?]\s*$/.test(cue.text.trim())) {
      flush();
    }
  }

  flush();

  return postProcessCues(merged, undefined, undefined, config);
}

/**
 * Merge cues for 2-line subtitle display.
 *
 * Philosophy: accumulate freely, flush only at natural breaks.
 *   - < TARGET_MIN (70): keep accumulating, never flush
 *   - >= TARGET_MIN: accept natural breaks (sentence end, conjunction)
 *   - HARD_MAX (160): safety net — find best split, rarely reached
 *
 * No hard wall between TARGET_MIN and HARD_MAX: text can grow to 100, 120,
 * 140 chars if no natural break appears. The display layer balances it
 * into 2 lines regardless.
 */
export function mergeCuesTwoLine(cues: SubtitleCue[], config?: PostProcessConfig): SubtitleCue[] {
  if (cues.length === 0) return [];

  const split = splitCuesAtSentences(deoverlapCues(cues));

  const TARGET_MIN = 70; // start accepting natural breaks
  const HARD_MAX = 160; // safety net for run-on text (rarely hit)
  const MAX_TIME = 10;
  const MIN_MARGIN = 15;
  const CONJ_RE =
    /^(and|but|so|or|because|although|while|since|if|when|where|which|who|that|however|yet|nor|before|after|unless|until|whether|then)\b/i;
  const CONJ_SPLIT =
    /\s+(?=(?:and|but|so|or|because|although|while|since|if|when|where|which|who|that|however|yet|nor|before|after)\b)/gi;

  const merged: SubtitleCue[] = [];
  let chunkStart = 0;
  let lastEnd = 0;
  let texts: string[] = [];

  /** Flush current chunk with trailing function-word stripping. */
  function flushWithStrip(): void {
    if (texts.length === 0) return;
    const text = texts.join(' ').trim();
    const { flush, leftover } = stripTrailingFuncWords(text, MIN_MARGIN);
    merged.push({ start: chunkStart, duration: lastEnd - chunkStart, text: flush });
    if (leftover) {
      const ratio = flush.length / text.length;
      chunkStart += (lastEnd - chunkStart) * ratio;
      texts = [leftover];
    } else {
      texts = [];
    }
  }

  /** Safety-net split for very long text: comma → conjunction → strip. */
  function safetyNetSplit(): void {
    const text = texts.join(' ').trim();
    // (a) comma nearest to middle
    const mid = text.length / 2;
    let bestComma = -1;
    let bestCommaDist = Infinity;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ',') {
        const pos = i + 1;
        if (pos < 30 || pos > text.length - 10) continue;
        const dist = Math.abs(pos - mid);
        if (dist < bestCommaDist) {
          bestCommaDist = dist;
          bestComma = pos;
        }
      }
    }
    if (bestComma > 0) {
      const before = text.substring(0, bestComma).trim();
      const after = text.substring(bestComma).trim();
      const { flush, leftover } = stripTrailingFuncWords(before, MIN_MARGIN);
      merged.push({ start: chunkStart, duration: lastEnd - chunkStart, text: flush });
      const parts = [leftover, after].filter(Boolean);
      if (parts.length > 0) {
        const ratio = flush.length / text.length;
        chunkStart += (lastEnd - chunkStart) * ratio;
        texts = [parts.join(' ')];
      } else {
        texts = [];
      }
      return;
    }
    // (b) conjunction nearest to middle
    let bestPos = -1;
    let bestDist = Infinity;
    let m;
    const re = new RegExp(CONJ_SPLIT.source, 'gi');
    while ((m = re.exec(text)) !== null) {
      if (m.index < MIN_MARGIN) continue;
      const dist = Math.abs(m.index - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestPos = m.index;
      }
    }
    if (bestPos > 0) {
      const before = text.substring(0, bestPos).trim();
      const after = text.substring(bestPos).trim();
      const { flush, leftover } = stripTrailingFuncWords(before, MIN_MARGIN);
      merged.push({ start: chunkStart, duration: lastEnd - chunkStart, text: flush });
      const parts = [leftover, after].filter(Boolean);
      if (parts.length > 0) {
        const ratio = flush.length / text.length;
        chunkStart += (lastEnd - chunkStart) * ratio;
        texts = [parts.join(' ')];
      } else {
        texts = [];
      }
      return;
    }
    // (c) fallback: strip trailing function words
    flushWithStrip();
  }

  for (const cue of split) {
    const currentText = texts.join(' ').trim();

    // Before adding: flush at conjunction boundary if >= TARGET_MIN
    if (texts.length > 0 && currentText.length >= TARGET_MIN && CONJ_RE.test(cue.text.trim())) {
      flushWithStrip();
    }

    // Add cue to accumulator
    if (texts.length === 0) chunkStart = cue.start;
    texts.push(cue.text);
    lastEnd = cue.start + cue.duration;

    const combined = texts.join(' ').trim();

    // After adding: flush at sentence end if >= TARGET_MIN
    if (combined.length >= TARGET_MIN && /[.!?]\s*$/.test(combined)) {
      merged.push({ start: chunkStart, duration: lastEnd - chunkStart, text: combined });
      texts = [];
      continue;
    }

    // Safety net: only for truly long run-on text or excessive time
    if (combined.length >= HARD_MAX || lastEnd - chunkStart >= MAX_TIME) {
      safetyNetSplit();
    }
  }

  if (texts.length > 0) {
    merged.push({
      start: chunkStart,
      duration: Math.max(lastEnd - chunkStart, 2),
      text: texts.join(' ').trim(),
    });
  }

  return postProcessCues(merged, 200, undefined, config);
}
