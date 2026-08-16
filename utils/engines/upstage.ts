import { ENGINE_ENDPOINTS } from '../constants';
import { DEFAULT_MODEL_IDS } from '../models';
import type { TranslationEngine } from './types';
import {
  buildTranslationPrompt,
  buildSubtitleTranslationPrompt,
  buildWordTranslationPrompt,
  buildSentenceTranslationPrompt,
  buildSegmentationPrompt,
  parseTranslationResponse,
  callWithRetry,
} from './llm-helpers';

/**
 * Upstage Solar — an OpenAI-compatible chat endpoint, so the request shape is
 * the same as `openai.ts`, minus `reasoning_effort`: Upstage documents that
 * solar-mini does not support reasoning and ignores that parameter. Sending it
 * would only imply a control we don't actually have.
 *
 * `temperature: 0.1` matches what the other engines use for translation — we
 * want the same sentence back every time, not variety.
 */
interface UpstageResponse {
  choices?: { message: { content: string } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  error?: { message: string; type?: string };
}

const TEMPERATURE = 0.1;

function request(apiKey: string, model: string, prompt: string): Promise<Response> {
  return callWithRetry(() =>
    fetch(ENGINE_ENDPOINTS.upstage, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: TEMPERATURE,
      }),
    }),
  );
}

function readContent(data: UpstageResponse): string {
  if (data.error) throw new Error(`Upstage API error: ${data.error.message}`);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from Upstage API');
  return content;
}

function readUsage(
  data: UpstageResponse,
): { inputTokens: number; outputTokens: number } | undefined {
  return data.usage
    ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
    : undefined;
}

export const upstageEngine: TranslationEngine = {
  async translate(apiKey, paragraphs, mode, subtitleContext, lang, modelId) {
    const model = modelId ?? DEFAULT_MODEL_IDS.upstage;

    if (mode === 'segment') {
      const data: UpstageResponse = await (
        await request(apiKey, model, buildSegmentationPrompt(paragraphs))
      ).json();
      return {
        translations: [{ id: '__raw__', translatedText: readContent(data).trim() }],
        usage: readUsage(data),
      };
    }

    const prompt =
      mode === 'word'
        ? buildWordTranslationPrompt(paragraphs, lang)
        : mode === 'sentence'
          ? buildSentenceTranslationPrompt(paragraphs, lang)
          : mode === 'subtitle'
            ? buildSubtitleTranslationPrompt(paragraphs, subtitleContext, lang)
            : buildTranslationPrompt(paragraphs, lang);

    const data: UpstageResponse = await (await request(apiKey, model, prompt)).json();
    return {
      translations: parseTranslationResponse(readContent(data), paragraphs),
      usage: readUsage(data),
    };
  },
};
