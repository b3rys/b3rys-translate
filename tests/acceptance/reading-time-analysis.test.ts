import { describe, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSubtitleResponse } from '@/entrypoints/content/youtube/subtitle-fetcher';
import { mergeCues } from '@/entrypoints/content/youtube/cue-merger';

function loadJsonFixture(name: string): string {
  return readFileSync(join(__dirname, '..', 'fixtures', name), 'utf-8');
}

/** Korean reading speed: ~8.3 chars/sec. Korean ≈ 1.2x English char count. */
const KO_CPS = 8.3;
const KO_RATIO = 1.2;

describe('Reading time analysis', () => {
  const fixtures = [
    { name: 'ASR bTQM3oEW0gk', file: 'youtube-timedtext-asr-bTQM3oEW0gk.json' },
    { name: 'ASR AUcYJczWXT4', file: 'youtube-timedtext-asr-AUcYJczWXT4.json' },
    { name: 'Manual tnsrnsy_Lus', file: 'youtube-timedtext-manual-tnsrnsy_Lus.json' },
  ];

  for (const f of fixtures) {
    it(`${f.name}: display time vs reading time`, () => {
      const raw = parseSubtitleResponse(loadJsonFixture(f.file));
      const merged = mergeCues(raw);

      let tooShortCount = 0;
      let totalDeficit = 0;
      const problems: string[] = [];

      for (let i = 0; i < merged.length; i++) {
        const cue = merged[i];
        const koChars = cue.text.length * KO_RATIO;
        const readingTime = koChars / KO_CPS;
        const deficit = readingTime - cue.duration;

        if (deficit > 0) {
          tooShortCount++;
          totalDeficit += deficit;
          if (problems.length < 5) {
            problems.push(
              `  [${i}] "${cue.text.slice(0, 50)}..." ` +
                `dur=${cue.duration.toFixed(2)}s need=${readingTime.toFixed(2)}s deficit=${deficit.toFixed(2)}s`,
            );
          }
        }
      }

      // Adjacent cue transition analysis: how much time does user have
      // between one cue ending and the next cue starting?
      let overlapCount = 0;
      let totalOverlap = 0;
      const transitions: string[] = [];

      for (let i = 1; i < merged.length; i++) {
        const prevEnd = merged[i - 1].start + merged[i - 1].duration;
        const gap = merged[i].start - prevEnd;
        if (gap < 0) {
          overlapCount++;
          totalOverlap += -gap;
          if (transitions.length < 5) {
            transitions.push(
              `  [${i - 1}→${i}] overlap=${(-gap).toFixed(2)}s ` +
                `prev ends ${prevEnd.toFixed(2)} next starts ${merged[i].start.toFixed(2)}`,
            );
          }
        }
      }

      console.log(`\n=== ${f.name} ===`);
      console.log(`Total cues: ${merged.length}`);
      console.log(
        `Reading time deficit: ${tooShortCount}/${merged.length} cues too short (${((tooShortCount / merged.length) * 100).toFixed(0)}%)`,
      );
      console.log(
        `Avg deficit: ${tooShortCount > 0 ? (totalDeficit / tooShortCount).toFixed(2) : 0}s`,
      );
      if (problems.length) {
        console.log('Worst examples:');
        problems.forEach((p) => console.log(p));
      }
      console.log(
        `\nOverlapping transitions: ${overlapCount}/${merged.length - 1} (${((overlapCount / (merged.length - 1)) * 100).toFixed(0)}%)`,
      );
      console.log(
        `Avg overlap: ${overlapCount > 0 ? (totalOverlap / overlapCount).toFixed(2) : 0}s`,
      );
      if (transitions.length) {
        console.log('Examples:');
        transitions.forEach((t) => console.log(t));
      }

      // Duration distribution
      const durations = merged.map((c) => c.duration);
      durations.sort((a, b) => a - b);
      console.log(`\nDuration distribution:`);
      console.log(
        `  min=${durations[0].toFixed(2)} p25=${durations[Math.floor(durations.length * 0.25)].toFixed(2)} median=${durations[Math.floor(durations.length * 0.5)].toFixed(2)} p75=${durations[Math.floor(durations.length * 0.75)].toFixed(2)} max=${durations[durations.length - 1].toFixed(2)}`,
      );
    });
  }
});
