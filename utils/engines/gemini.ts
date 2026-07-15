import { ENGINE_ENDPOINTS } from '../constants';
import type { TranslationEngine } from './types';
import {
  buildTranslationPrompt,
  buildSubtitleTranslationPrompt,
  buildWordTranslationPrompt,
  buildSegmentationPrompt,
  parseTranslationResponse,
  callWithRetry,
} from './llm-helpers';

import type { UsageData } from './types';

interface GeminiResponse {
  candidates?: {
    content: { parts: { text: string }[] };
    finishReason: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { message: string; code: number };
}

async function callGeminiAPI(
  apiKey: string,
  prompt: string,
): Promise<{ text: string; usage?: UsageData }> {
  const response = await callWithRetry(() =>
    fetch(ENGINE_ENDPOINTS.gemini, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      }),
    }),
  );

  const data: GeminiResponse = await response.json();

  if (data.error) {
    throw new Error(`Gemini API error: ${data.error.message}`);
  }

  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error('Empty response from Gemini API');
  }

  const usage: UsageData | undefined = data.usageMetadata
    ? {
        inputTokens: data.usageMetadata.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
      }
    : undefined;

  return { text: data.candidates[0].content.parts[0].text, usage };
}

export const geminiEngine: TranslationEngine = {
  async translate(apiKey, paragraphs, mode, subtitleContext, lang) {
    if (mode === 'segment') {
      const prompt = buildSegmentationPrompt(paragraphs);
      const { text, usage } = await callGeminiAPI(apiKey, prompt);
      return {
        translations: [{ id: '__raw__', translatedText: text.trim() }],
        usage,
      };
    }

    const prompt =
      mode === 'word'
        ? buildWordTranslationPrompt(paragraphs, lang)
        : mode === 'subtitle'
          ? buildSubtitleTranslationPrompt(paragraphs, subtitleContext, lang)
          : buildTranslationPrompt(paragraphs, lang);
    const { text, usage } = await callGeminiAPI(apiKey, prompt);
    return {
      translations: parseTranslationResponse(text, paragraphs),
      usage,
    };
  },
};
