import type { TranslationRequestMode } from './translation-types';

export interface TranslateBatchRequest {
  type: 'TRANSLATE_BATCH';
  paragraphs: { id: string; text: string }[];
  mode?: TranslationRequestMode;
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

export interface ToggleAutoTranslateMessage {
  type: 'TOGGLE_AUTO_TRANSLATE';
  enabled: boolean;
}

/**
 * Top frame → background: the FAB intent changed. The background fans it out
 * to every frame of the sender's tab as FRAME_TOGGLE. A content script cannot
 * address its own sub-frames directly, and a stored flag only fires
 * storage.onChanged when its value actually changes.
 */
export interface RelayFrameToggleMessage {
  type: 'RELAY_FRAME_TOGGLE';
  enabled: boolean;
}

/** Background → every frame of one tab: apply the top frame's FAB intent. */
export interface FrameToggleMessage {
  type: 'FRAME_TOGGLE';
  enabled: boolean;
}

/**
 * Pure cache read — no API call, no rate-limit slot, no usage stats.
 * Lets the content script paint cached paragraphs instantly and send
 * only the misses through TRANSLATE_BATCH.
 */
export interface CacheLookupRequest {
  type: 'CACHE_LOOKUP';
  paragraphs: { id: string; text: string }[];
  targetLang?: string;
}

export interface CacheLookupResponse {
  translations: { id: string; translatedText: string }[];
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

export type BackgroundMessage =
  | TranslateBatchRequest
  | CacheLookupRequest
  | OpenPopupRequest
  | ClearCacheRequest
  | RelayFrameToggleMessage;
export type ContentMessage =
  | ToggleTranslationMessage
  | ToggleFloatingButtonMessage
  | ToggleYtButtonMessage
  | ToggleTranslationModeMessage
  | ToggleAutoTranslateMessage
  | FrameToggleMessage;
