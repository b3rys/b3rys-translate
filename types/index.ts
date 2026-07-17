export interface TextBlock {
  id: string;
  element: HTMLElement;
  text: string;
  html: string;
}

export interface TranslationResult {
  id: string;
  translatedText: string;
}

export type FloatingButtonState = 'idle' | 'loading' | 'done' | 'error';

export type TranslationMode = 'parallel' | 'replace';

export type TranslationState = 'idle' | 'translating' | 'done' | 'error';

// YouTube subtitle types
export interface SubtitleCue {
  start: number; // seconds
  duration: number;
  text: string;
  /** Original speech end time (before LEAD/PAD adjustment).
   *  Used by overlay to prevent premature cue switching. */
  speechEnd?: number;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  name: string;
  kind?: string; // 'asr' for auto-generated
}
