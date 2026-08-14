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

export interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: { input_tokens: number; output_tokens: number };
  error?: { type: string; message: string };
}

/**
 * Pull the assistant's text out of the response.
 *
 * `content` is an array of *typed blocks*, and text is not guaranteed to be
 * first — a model that emits thinking leads with a `thinking` block, which has
 * no `text` field. Reading `content[0].text` positionally turned that into
 * "Empty response from Anthropic API", which names the wrong cause and sends
 * whoever debugs it looking at the network layer.
 *
 * Neither selectable Anthropic model thinks by default and the request never
 * asks one to, so this is not reachable today. It is here so that changing the
 * model surfaces a real failure instead of a misleading one.
 */
export function extractText(data: AnthropicResponse): string | undefined {
  return data.content?.find((block) => block.type === 'text')?.text;
}

/** Fail with the actual reason rather than letting it read as an empty body. */
export function assertUsable(data: AnthropicResponse): void {
  if (data.error) {
    throw new Error(`Anthropic API error: ${data.error.message}`);
  }
  if (data.stop_reason === 'refusal') {
    throw new Error('Anthropic API declined this request (safety classifier).');
  }
}

export const anthropicEngine: TranslationEngine = {
  async translate(apiKey, paragraphs, mode, subtitleContext, lang, modelId) {
    const model = modelId ?? DEFAULT_MODEL_IDS.anthropic;
    if (mode === 'segment') {
      const prompt = buildSegmentationPrompt(paragraphs);
      const response = await callWithRetry(() =>
        fetch(ENGINE_ENDPOINTS.anthropic, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model,
            max_tokens: 8192,
            messages: [{ role: 'user', content: prompt }],
          }),
        }),
      );
      const data: AnthropicResponse = await response.json();
      assertUsable(data);
      const text = extractText(data);
      if (!text) throw new Error('Empty response from Anthropic API');
      return {
        translations: [{ id: '__raw__', translatedText: text.trim() }],
        usage: data.usage
          ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
          : undefined,
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

    const response = await callWithRetry(() =>
      fetch(ENGINE_ENDPOINTS.anthropic, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }],
        }),
      }),
    );

    const data: AnthropicResponse = await response.json();

    assertUsable(data);

    const text = extractText(data);
    if (!text) {
      throw new Error('Empty response from Anthropic API');
    }

    return {
      translations: parseTranslationResponse(text, paragraphs),
      usage: data.usage
        ? {
            inputTokens: data.usage.input_tokens,
            outputTokens: data.usage.output_tokens,
          }
        : undefined,
    };
  },
};
