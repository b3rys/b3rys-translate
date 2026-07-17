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

interface OpenAIResponse {
  choices?: { message: { content: string } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  error?: { message: string; type: string };
}

export const openaiEngine: TranslationEngine = {
  async translate(apiKey, paragraphs, mode, subtitleContext, lang) {
    if (mode === 'segment') {
      const prompt = buildSegmentationPrompt(paragraphs);
      const response = await callWithRetry(() =>
        fetch(ENGINE_ENDPOINTS.openai, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: ENGINE_MODELS.openai,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
          }),
        }),
      );
      const data: OpenAIResponse = await response.json();
      if (data.error) throw new Error(`OpenAI API error: ${data.error.message}`);
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from OpenAI API');
      return {
        translations: [{ id: '__raw__', translatedText: content.trim() }],
        usage: data.usage
          ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
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
      fetch(ENGINE_ENDPOINTS.openai, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: ENGINE_MODELS.openai,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
        }),
      }),
    );

    const data: OpenAIResponse = await response.json();

    if (data.error) {
      throw new Error(`OpenAI API error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI API');
    }

    return {
      translations: parseTranslationResponse(content, paragraphs),
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          }
        : undefined,
    };
  },
};
