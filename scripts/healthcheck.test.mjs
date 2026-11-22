// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasThinking, probe, notify, summarize } from './healthcheck.mjs';

describe('weekly health check', () => {
  it('finds returned thinking but permits internal reasoning usage counters', () => {
    for (const body of [
      {
        content: [
          { type: 'thinking', thinking: 'secret' },
          { type: 'text', text: '번역' },
        ],
      },
      { candidates: [{ content: { parts: [{ thought: true, text: 'secret' }] } }] },
      { choices: [{ message: { reasoning_content: 'secret', content: '번역' } }] },
      { choices: [{ message: { content: '<think>secret</think>번역' } }] },
    ])
      expect(hasThinking(body)).toBe(true);
    expect(hasThinking({ usage: { completion_tokens_details: { reasoning_tokens: 12 } } })).toBe(
      false,
    );
  });

  it('skips absent key paths and fails unreadable paths without exposing them', async () => {
    const engine = vi.fn();
    expect(
      (await probe({ id: 'm', engine: 'openai' }, undefined, engine, undefined, {})).status,
    ).toBe('skip');
    const failed = await probe({ id: 'm', engine: 'openai' }, '/missing-private-key', engine);
    expect(failed.status).toBe('fail');
    expect(JSON.stringify(failed)).not.toContain('/missing-private-key');
    expect(engine).not.toHaveBeenCalled();
  });

  it('uses the engine once, detects hidden thinking, redacts provider errors, restores fetch', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'health-unit-'));
    const keyFile = join(temp, 'key');
    const secret = 'unit-test-secret';
    const original = globalThis.fetch;
    await writeFile(keyFile, secret);
    try {
      const network = vi.fn(
        async () =>
          new globalThis.Response(
            JSON.stringify({
              content: [{ type: 'thinking', thinking: 'private chain' }],
            }),
            { status: 200 },
          ),
      );
      const getEngine = () => ({
        translate: async (key) => {
          expect(key).toBe(secret);
          await globalThis.fetch('https://example.invalid', { body: '{}' });
          return { translations: [{ id: 'health', translatedText: '하늘은 파랗다.' }] };
        },
      });
      const result = await probe({ id: 'm', engine: 'anthropic' }, keyFile, getEngine, network);
      expect(result).toMatchObject({
        status: 'fail',
        thinking: true,
        detail: 'thinking_block_returned',
      });
      expect(typeof result.latencyMs).toBe('number');
      expect(network).toHaveBeenCalledTimes(1);
      const requestBody = JSON.parse(network.mock.calls[0][1].body);
      expect(requestBody.max_tokens).toBe(64);
      expect(globalThis.fetch).toBe(original);
      const badEngine = () => ({
        translate: async () => {
          throw new Error(secret);
        },
      });
      const failure = await probe({ id: 'm', engine: 'openai' }, keyFile, badEngine);
      expect(failure.status).toBe('fail');
      expect(JSON.stringify(failure)).not.toContain(secret);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it('reads the approved environment variable without requiring a key file', async () => {
    const engine = () => ({
      translate: async (key) => {
        expect(key).toBe('env-test-value');
        await globalThis.fetch('https://example.invalid', { body: '{}' });
        return { translations: [{ id: 'health', translatedText: '하늘은 파랗다.' }] };
      },
    });
    const network = vi.fn(async () => new globalThis.Response('{}'));
    const result = await probe({ id: 'm', engine: 'openai' }, undefined, engine, network, {
      OPENAI_API_KEY: 'env-test-value',
    });
    expect(result.status).toBe('pass');
    expect(JSON.parse(network.mock.calls[0][1].body).max_completion_tokens).toBe(64);
    expect(JSON.stringify(result)).not.toContain('env-test-value');
  });

  it('never makes a second paid request when an engine retries', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'health-unit-'));
    const keyFile = join(temp, 'key');
    await writeFile(keyFile, 'test');
    const network = vi.fn(async () => new globalThis.Response('{}', { status: 503 }));
    try {
      const engine = () => ({
        translate: async () => {
          await globalThis.fetch('https://example.invalid', { body: '{}' });
          await globalThis.fetch('https://example.invalid', { body: '{}' });
        },
      });
      expect((await probe({ id: 'm', engine: 'openai' }, keyFile, engine, network)).status).toBe(
        'fail',
      );
      expect(network).toHaveBeenCalledTimes(1);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it('stays quiet on pass/skip, sends only failures and exposes adapter failure', () => {
    const send = vi.fn(() => ({ status: 0 }));
    const config = { notifyCommand: ['adapter', 'lisa'] };
    const pass = [
      { name: 'm', status: 'pass' },
      { name: 'n', status: 'skip' },
    ];
    expect(summarize(pass)).toContain('PARTIAL');
    expect(notify(pass, config, send)).toBe('not_needed');
    expect(send).not.toHaveBeenCalled();
    const failed = [{ name: 'm', status: 'fail', detail: 'injected_failure' }];
    expect(notify(failed, config, send)).toBe('sent');
    expect(send.mock.calls[0][2].input).toContain('injected_failure');
    expect(notify(failed, config, () => ({ status: 1 }))).toBe('failed');
    expect(notify(failed, {})).toBe('not_configured');
  });
});
