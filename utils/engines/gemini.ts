import { DEFAULT_MODEL_IDS, type ModelId } from '../models';
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
  modelId: ModelId,
): Promise<{ text: string; usage?: UsageData }> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
  const response = await callWithRetry(() =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          // 번역은 창작이 아니다. 같은 문단은 같게 나와야 하고, 응답이 JSON 이라
          // 형식이 흔들리면 파싱이 깨진다. 그래서 낮게 고정한다.
          //
          // 모델 선택 기능을 넣으면서 이 줄이 사라졌었다. 카탈로그의 Gemini 는
          // 3.1 하나뿐이고 이 모델은 temperature 를 정상 지원하므로 뺄 이유가
          // 없었다 — temperature 를 무시하는 것은 3.5-flash-lite 부터다.
          // (근거: _workspace/model-research/google.md)
          //
          // temperature 를 지원하지 않는 모델을 카탈로그에 추가할 때는 여기서
          // 모델별로 분기할 것. 지금은 분기가 필요 없다.
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
  async translate(apiKey, paragraphs, mode, subtitleContext, lang, modelId) {
    const model = modelId ?? DEFAULT_MODEL_IDS.gemini;
    if (mode === 'segment') {
      const prompt = buildSegmentationPrompt(paragraphs);
      const { text, usage } = await callGeminiAPI(apiKey, prompt, model);
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
    const { text, usage } = await callGeminiAPI(apiKey, prompt, model);
    return {
      translations: parseTranslationResponse(text, paragraphs),
      usage,
    };
  },
};
