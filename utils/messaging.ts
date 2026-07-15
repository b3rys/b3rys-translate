export interface TranslateBatchRequest {
  type: 'TRANSLATE_BATCH';
  paragraphs: { id: string; text: string }[];
  mode?: 'page' | 'subtitle' | 'word' | 'segment';
  subtitleContext?: { original: string; translated: string }[];
  sourceLang?: string;
  targetLang?: string;
}

export interface TranslateBatchResponse {
  translations: { id: string; translatedText: string }[];
  error?: string;
  apiKeyError?: boolean;
  costLimitExceeded?: boolean;
  totalCost?: number;
}

export interface ToggleTranslationMessage {
  type: 'TOGGLE_TRANSLATION';
  enabled: boolean;
}

export interface ToggleFloatingButtonMessage {
  type: 'TOGGLE_FLOATING_BUTTON';
  visible: boolean;
}

export interface ToggleYtButtonMessage {
  type: 'TOGGLE_YT_BUTTON';
  visible: boolean;
}

export interface ToggleTranslationModeMessage {
  type: 'TOGGLE_TRANSLATION_MODE';
  mode: 'parallel' | 'replace';
}

export interface OpenPopupRequest {
  type: 'OPEN_POPUP';
}

export interface ClearCacheRequest {
  type: 'CLEAR_CACHE';
}

export interface ClearCacheResponse {
  success: boolean;
}

export type BackgroundMessage = TranslateBatchRequest | OpenPopupRequest | ClearCacheRequest;
export type ContentMessage =
  | ToggleTranslationMessage
  | ToggleFloatingButtonMessage
  | ToggleYtButtonMessage
  | ToggleTranslationModeMessage;
