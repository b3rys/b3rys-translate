// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRemoteData } from '../utils/remote-data';
import { loadModelCatalog } from '../utils/model-catalog';
import { parseEtymology } from '../utils/etymology';
import models from '../config/models.json';
import fixtureIndex from './fixtures/remote-data/index.json';
import translate from './fixtures/remote-data/etym/translate.json';
import telescope from './fixtures/remote-data/etym/telescope.json';

let server: Server;
let indexUrl: string;
let index: typeof fixtureIndex;
let offline: boolean;
let badWord: boolean;
let slow: boolean;
let calls: string[];
let clock: number;
let saved: unknown;
let line: string;
beforeAll(async () => {
  server = createServer(async (req, res) => {
    calls.push(req.url!);
    if (slow) return;
    if (offline) {
      res.writeHead(503).end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/index.json') {
      res.end(JSON.stringify(index));
      return;
    }
    if (req.url === '/etym/translate.json') {
      res.end(
        JSON.stringify(
          badWord ? { word: 'wrong' } : { ...translate, story: { ...translate.story, line } },
        ),
      );
      return;
    }
    if (req.url === '/etym/telescope.json') {
      res.end(JSON.stringify(telescope));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  indexUrl = `http://127.0.0.1:${address.port}/index.json`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  index = structuredClone(fixtureIndex);
  offline = false;
  badWord = false;
  slow = false;
  calls = [];
  clock = 0;
  saved = undefined;
  line = translate.story.line;
});
const client = (url: string | null = indexUrl) =>
  createRemoteData({
    indexUrl: url,
    now: () => clock,
    timeoutMs: 50,
    read: async () => structuredClone(saved),
    write: async (value) => {
      saved = structuredClone(value);
    },
  });

describe('remote data via local HTTP', () => {
  it('loads cards lazily and replaces cached words on a new version', async () => {
    const data = client();
    await data.getCatalog();
    expect(calls).toEqual(['/index.json']);
    expect((await data.getEtymology('Translate'))?.story?.line).toBe(line);
    line = '새 version의 설명';
    expect((await data.getEtymology('translate'))?.story?.line).not.toBe(line);
    index.version = 2;
    clock += 600001;
    expect((await data.getEtymology('translate'))?.story?.line).toBe(line);
    expect(calls.filter((url) => url === '/etym/translate.json')).toHaveLength(2);
    const restarted = client();
    offline = true;
    expect((await restarted.getEtymology('translate'))?.story?.line).toBe(line);
  });
  it('falls back to persisted data on server failure and to bundle on a cold start', async () => {
    index.models.models[0].label = '원격 모델';
    const data = client();
    expect((await data.getCatalog()).models[0].label).toBe('원격 모델');
    await data.getEtymology('translate');
    offline = true;
    const restarted = client();
    expect((await restarted.getCatalog()).models[0].label).toBe('원격 모델');
    expect(await restarted.getEtymology('translate')).toEqual(translate);
    expect(await restarted.getEtymology('telescope')).toBeNull();
    saved = undefined;
    expect(await client().getCatalog()).toEqual(loadModelCatalog(models));
    expect(await client().getEtymology('translate')).toBeNull();
  });
  it('rejects invalid remote models wholly and returns bundled models', async () => {
    index.models.models[0].label = '원격 모델';
    index.models.models[1].pricing.input = -1;
    expect(await client().getCatalog()).toEqual(loadModelCatalog(models));
    expect(await client().getEtymology('telescope')).toEqual(telescope);
  });
  it('checks the index on popup opening and retries after the interval', async () => {
    const data = client();
    await data.getCatalog();
    await data.getCatalog();
    expect(calls).toHaveLength(1);
    await data.getCatalog(true);
    expect(calls).toHaveLength(2);
    clock += 600001;
    await data.getCatalog();
    expect(calls).toHaveLength(3);
  });
  it('keeps the last cache for a malformed index and rejects mismatched word data', async () => {
    const data = client();
    await data.getEtymology('translate');
    index.etym.base = 'https://unconfigured.invalid/';
    clock += 600001;
    expect(await data.getEtymology('translate')).toEqual(translate);
    badWord = true;
    expect(await client().getEtymology('translate')).toEqual(translate);
    saved = undefined;
    index.etym.base = './etym/';
    expect(await client().getEtymology('translate')).toBeNull();
  });
  it('serializes overlapping reads so a word is fetched only once', async () => {
    const data = client();
    const results = await Promise.all([
      data.getEtymology('translate'),
      data.getEtymology('translate'),
    ]);
    expect(results).toEqual([translate, translate]);
    expect(calls).toEqual(['/index.json', '/etym/translate.json']);
  });
  it('treats a corrupt cache, storage failure and request timeout as recoverable', async () => {
    saved = { indexUrl, snapshot: { index: null } };
    const data = createRemoteData({
      indexUrl,
      timeoutMs: 25,
      read: async () => saved,
      write: async () => {
        throw new Error('quota');
      },
    });
    expect(await data.getEtymology('telescope')).toEqual(telescope);
    saved = undefined;
    slow = true;
    expect(await client().getCatalog()).toEqual(loadModelCatalog(models));
  });
  it('isolates environments and disables all network and cache access in prod', async () => {
    await client().getEtymology('translate');
    offline = true;
    expect(await client(indexUrl + '?other-environment').getEtymology('translate')).toBeNull();
    calls = [];
    expect(await client(null).getCatalog()).toEqual(loadModelCatalog(models));
    expect(await client(null).getEtymology('translate')).toBeNull();
    expect(calls).toEqual([]);
  });
  it('rejects path traversal, malformed cards and executable image references', async () => {
    expect(await client().getEtymology('../translate')).toBeNull();
    expect(calls).toEqual([]);
    expect(
      parseEtymology(
        { ...translate, story: { ...translate.story, scene_image: 'javascript:alert(1)' } },
        'translate',
      ),
    ).toBeNull();
    expect(parseEtymology({ ...telescope, hanja: {} }, 'telescope')).toBeNull();
    expect(
      parseEtymology(
        { ...translate, roots: [{ form: 'a', lang: 'b', meaning_ko: 'c', next: '../x' }] },
        'translate',
      ),
    ).toBeNull();
    expect(parseEtymology({ ...translate, uncertain: [2] }, 'translate')).toBeNull();
  });
  it('fetches object prototype names as words and handles malformed runtime input', async () => {
    const data = client();
    expect(await data.getEtymology('constructor')).toBeNull();
    expect(calls).toContain('/etym/constructor.json');
    expect(await data.getEtymology(null as unknown as string)).toBeNull();
  });
  it('keeps the dev index model fixture synchronized with the bundle', async () => {
    expect(fixtureIndex.models).toEqual(models);
    expect(
      await readFile(
        new URL('./fixtures/remote-data/images/translate.svg', import.meta.url),
        'utf8',
      ),
    ).toContain('<svg');
  });
});
