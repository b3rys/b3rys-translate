import { ENGINE_ENDPOINTS, ENGINE_MODELS } from '../constants';
import type { TranslationEngine } from './types';
import {
  buildTranslationPrompt,
  buildSubtitleTranslationPrompt,
  buildWordTranslationPrompt,
  buildSegmentationPrompt,
  parseTranslationResponse,
  callWithRetry,
} from './llm-helpers';

interface AnthropicResponse {
  content?: { type: string; text: string }[];
  usage?: { input_tokens: number; output_tokens: number };
  error?: { type: string; message: string };
}

export const anthropicEngine: TranslationEngine = {
  async translate(apiKey, paragraphs, mode, subtitleContext, lang) {
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
            model: ENGINE_MODELS.anthropic,
            max_tokens: 8192,
            messages: [{ role: 'user', content: prompt }],
          }),
        }),
      );
      const data: AnthropicResponse = await response.json();
      if (data.error) throw new Error(`Anthropic API error: ${data.error.message}`);
      const text = data.content?.[0]?.text;
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
          model: ENGINE_MODELS.anthropic,
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }],
        }),
      }),
    );

    const data: AnthropicResponse = await response.json();

    if (data.error) {
      throw new Error(`Anthropic API error: ${data.error.message}`);
    }

    const text = data.content?.[0]?.text;
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
