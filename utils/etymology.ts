export interface Etymology {
  kind: 'hanja' | 'story';
  word: string;
  ipa: string;
  gloss_ko: string;
  hanja?: {
    ko: string;
    chars: { ch: string; hun_eum: string }[];
    pairs: { ko: string; ch: string; root: string; origin: string }[];
  };
  story?: { scene_image: string; known: string[]; motion: string; line: string };
  roots: { form: string; lang: string; meaning_ko: string; next?: string }[];
  sources: { name: string; url: string }[];
  uncertain: string[];
}

export const wordId = (value: string) => /^[a-z][a-z0-9'-]{0,79}$/.test(value);
export const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const fields = (value: unknown, keys: string[]) =>
  record(value) && keys.every((key) => typeof value[key] === 'string');
const rows = (value: unknown, keys: string[]) =>
  Array.isArray(value) && value.every((row) => fields(row, keys));

/** Validate data only. Consumers render text, never HTML from this document. */
export function parseEtymology(value: unknown, word: string): Etymology | null {
  if (!record(value) || value.word !== word || !fields(value, ['ipa', 'gloss_ko'])) return null;
  if (
    !rows(value.roots, ['form', 'lang', 'meaning_ko']) ||
    !(value.roots as Record<string, unknown>[]).every(
      (root) => root.next === undefined || (typeof root.next === 'string' && wordId(root.next)),
    )
  )
    return null;
  if (
    !rows(value.sources, ['name', 'url']) ||
    !(value.sources as { url: string }[]).every(({ url }) => /^https?:\/\//.test(url)) ||
    !strings(value.uncertain)
  )
    return null;
  if (value.kind === 'hanja') {
    const h = value.hanja;
    if (
      !record(h) ||
      typeof h.ko !== 'string' ||
      !rows(h.chars, ['ch', 'hun_eum']) ||
      !rows(h.pairs, ['ko', 'ch', 'root', 'origin'])
    )
      return null;
  } else if (value.kind === 'story') {
    const s = value.story;
    if (!record(s) || !fields(s, ['scene_image', 'motion', 'line']) || !strings(s.known))
      return null;
    // Images are references, never inline SVG/HTML or executable URLs.
    if (!/^(https?:\/\/|\.?\.?\/|[a-zA-Z0-9_-]+\/)/.test(s.scene_image as string)) return null;
  } else return null;
  return structuredClone(value) as unknown as Etymology;
}
