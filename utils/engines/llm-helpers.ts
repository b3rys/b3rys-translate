import { MAX_RETRIES, RETRY_DELAY_BASE, LANGUAGES, type LanguageCode } from '../constants';

interface LangPair {
  sourceLang?: string;
  targetLang?: string;
}

function tgtName(pair: LangPair): string {
  return LANGUAGES[(pair.targetLang ?? 'ko') as LanguageCode]?.name ?? 'Korean';
}

export function buildTranslationPrompt(
  paragraphs: { id: string; text: string }[],
  lang?: LangPair,
): string {
  const tgt = tgtName(lang ?? {});
  const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n');

  return `You are a professional translator. Translate each numbered paragraph below into ${tgt}.
Return ONLY the ${tgt} translations, each prefixed with its number in the same [N] format.
Maintain the original meaning, tone, and paragraph structure.
Preserve all HTML tags (<a>, <code>, <strong>, <em>, etc.) exactly as they appear. Only translate the text content within them, not the tags or their attributes.
Do not add explanations or notes.

${numbered}`;
}

export function buildWordTranslationPrompt(
  paragraphs: { id: string; text: string }[],
  lang?: LangPair,
): string {
  const tgt = tgtName(lang ?? {});
  const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p.text}`).join('\n');

  return `You are a professional translator. For each numbered word/phrase below, provide:
1. The ${tgt} translation (just the word, no romanization or pronunciation guide)
2. A brief English definition (one short phrase, no full sentence)
3. Two similar/related English words
4. Two short example sentences using the word, each with ${tgt} translation

IMPORTANT: Do NOT include romanization, phonetic transcription, or pronunciation in parentheses. Only provide the translation in ${tgt} script.

Format:
[N] ${tgt} translation
= brief English definition
~ similar word 1, similar word 2
• Example sentence 1
→ ${tgt} translation 1
• Example sentence 2
→ ${tgt} translation 2

${numbered}`;
}

export function buildSubtitleTranslationPrompt(
  paragraphs: { id: string; text: string }[],
  context?: { original: string; translated: string }[],
  lang?: LangPair,
): string {
  const tgt = tgtName(lang ?? {});
  const tgtCode = (lang?.targetLang ?? 'ko').toUpperCase();
  let contextSection = '';
  if (context && context.length > 0) {
    contextSection = '[Previous subtitles for reference — do not translate these]\n';
    for (const c of context) {
      contextSection += `Original: ${c.original} → ${tgtCode}: ${c.translated}\n`;
    }
    contextSection += '\n';
  }

  const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p.text}`).join('\n');

  return `You are a professional subtitle translator. Translate each numbered subtitle line below into ${tgt}.
Return ONLY the ${tgt} translations, each prefixed with its number in the same [N] format.
Keep translations concise and natural for subtitles.
Maintain contextual flow — these are consecutive subtitles from a video.
Do not add explanations or notes.

${contextSection}${numbered}`;
}

export function buildSegmentationPrompt(paragraphs: { id: string; text: string }[]): string {
  const fullText = paragraphs.map((p) => p.text).join(' ');

  return `Add punctuation to this auto-generated YouTube subtitle text. Insert periods, commas, question marks, and exclamation marks where sentences end or natural pauses occur. Capitalize the first word of each sentence. Do not change, add, or remove any words. Output ONLY the punctuated text.

${fullText}`;
}

export function parseTranslationResponse(
  response: string,
  originalParagraphs: { id: string; text: string }[],
): { id: string; translatedText: string }[] {
  const translations: { id: string; translatedText: string }[] = [];
  const regex = /\[(\d+)\]\s*([\s\S]*?)(?=\n\s*\[\d+\]|$)/g;
  let match;

  while ((match = regex.exec(response)) !== null) {
    const index = parseInt(match[1]) - 1;
    const text = match[2].trim();
    if (index >= 0 && index < originalParagraphs.length && text) {
      translations.push({
        id: originalParagraphs[index].id,
        translatedText: text,
      });
    }
  }

  return translations;
}

export async function callWithRetry(
  fn: () => Promise<Response>,
  maxRetries = MAX_RETRIES,
  delayBase = RETRY_DELAY_BASE,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fn();

      if (response.status === 429 || response.status >= 500) {
        const delay = delayBase * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        const delay = delayBase * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error('Request failed after retries');
}
