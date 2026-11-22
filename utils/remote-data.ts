import bundledModels from '../config/models.json';
import { loadModelCatalog, type ModelCatalog } from './model-catalog';
import { parseEtymology, record, wordId, type Etymology } from './etymology';

interface DataIndex {
  version: string | number;
  models: unknown;
  etym: { base: string; count: number };
}
interface Snapshot {
  index: DataIndex;
  words: Record<string, Etymology>;
}
export interface RemoteDataOptions {
  indexUrl: string | null;
  read: () => Promise<unknown>;
  write: (value: unknown) => Promise<void>;
  fetcher?: typeof fetch;
  now?: () => number;
  refreshMs?: number;
  timeoutMs?: number;
}
const bundled = loadModelCatalog(bundledModels);

function parseIndex(raw: unknown, indexUrl: string): DataIndex | null {
  if (
    !record(raw) ||
    !(
      (typeof raw.version === 'string' && raw.version.length > 0) ||
      (typeof raw.version === 'number' && Number.isFinite(raw.version))
    ) ||
    !record(raw.etym) ||
    typeof raw.etym.base !== 'string' ||
    !Number.isSafeInteger(raw.etym.count) ||
    (raw.etym.count as number) < 0
  )
    return null;
  const base = new URL(raw.etym.base, indexUrl);
  // A data document cannot expand the configured network origin or attach credentials.
  if (
    base.origin !== new URL(indexUrl).origin ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !base.pathname.endsWith('/')
  )
    return null;
  return {
    version: raw.version,
    models: raw.models,
    etym: { base: base.href, count: raw.etym.count as number },
  };
}

/** One owner serializes index + word commits, including across service-worker restarts. */
export function createRemoteData(options: RemoteDataOptions) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let snapshot: Snapshot | undefined;
  let initialized = false;
  let checkedAt = -Infinity;
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const persist = async () => {
    try {
      await options.write({ indexUrl: options.indexUrl, snapshot });
    } catch {
      // Storage quota/unavailability must not break translation or the in-memory cache.
    }
  };
  const json = async (url: string): Promise<unknown> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2000);
    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Data server unavailable');
      const text = await response.text();
      if (text.length > 1_000_000) throw new Error('Data document too large');
      return JSON.parse(text);
    } finally {
      clearTimeout(timeout);
    }
  };
  const refresh = async (force: boolean) => {
    if (!options.indexUrl) return;
    if (!initialized) {
      initialized = true;
      try {
        const saved = await options.read();
        if (record(saved) && saved.indexUrl === options.indexUrl && record(saved.snapshot)) {
          const index = parseIndex(saved.snapshot.index, options.indexUrl);
          if (index) {
            snapshot = { index, words: {} };
            if (record(saved.snapshot.words)) {
              for (const [word, raw] of Object.entries(saved.snapshot.words).slice(-200)) {
                const data = wordId(word) ? parseEtymology(raw, word) : null;
                if (data) snapshot.words[word] = data;
              }
            }
          }
        }
      } catch {
        /* A corrupt cache is a cold start. */
      }
    }
    if (!force && now() - checkedAt < (options.refreshMs ?? 600000)) return;
    checkedAt = now();
    try {
      const index = parseIndex(await json(options.indexUrl), options.indexUrl);
      if (!index) return;
      if (
        !snapshot ||
        snapshot.index.version !== index.version ||
        snapshot.index.etym.base !== index.etym.base
      ) {
        snapshot = { index, words: {} };
      } else {
        snapshot.index = index;
      }
      await persist();
    } catch {
      /* Retain the last validated snapshot on network/schema failure. */
    }
  };
  return {
    getCatalog: (force = false): Promise<ModelCatalog> =>
      serialize(async () => {
        await refresh(force);
        if (!snapshot) return bundled;
        const catalog = loadModelCatalog(snapshot.index.models);
        // The existing loader repairs partial catalogs; remote data must pass it wholly.
        return catalog.diagnostics.length ? bundled : catalog;
      }),
    getEtymology: (input: string): Promise<Etymology | null> =>
      serialize(async () => {
        if (typeof input !== 'string') return null;
        const word = input.toLowerCase();
        if (!wordId(word)) return null;
        await refresh(false);
        if (!snapshot) return null;
        if (Object.hasOwn(snapshot.words, word)) return structuredClone(snapshot.words[word]);
        try {
          const value = parseEtymology(
            await json(new URL(`${word}.json`, snapshot.index.etym.base).href),
            word,
          );
          if (!value) return null;
          snapshot.words[word] = value;
          if (Object.keys(snapshot.words).length > 200)
            delete snapshot.words[Object.keys(snapshot.words)[0]];
          await persist();
          return structuredClone(value);
        } catch {
          return null;
        }
      }),
  };
}
