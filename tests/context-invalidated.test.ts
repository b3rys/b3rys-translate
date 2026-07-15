import { describe, it, expect, beforeEach, vi } from 'vitest';

// isContextInvalidated is pure — safe to import statically
import { isContextInvalidated } from '@/entrypoints/content/context-invalidated';

beforeEach(() => {
  vi.resetModules();
});

describe('isContextInvalidated', () => {
  it('returns true for "Extension context invalidated"', () => {
    expect(isContextInvalidated(new Error('Extension context invalidated'))).toBe(true);
  });

  it('returns true for "Receiving end does not exist"', () => {
    expect(isContextInvalidated(new Error('Receiving end does not exist'))).toBe(true);
  });

  it('returns true when message contains the pattern with extra text', () => {
    expect(
      isContextInvalidated(
        new Error('Could not establish connection. Receiving end does not exist.'),
      ),
    ).toBe(true);
  });

  it('returns true for TypeError on undefined chrome.storage', () => {
    expect(
      isContextInvalidated(new TypeError("Cannot read properties of undefined (reading 'sync')")),
    ).toBe(true);
  });

  it('returns true for TypeError on undefined chrome.runtime', () => {
    expect(
      isContextInvalidated(
        new TypeError("Cannot read properties of undefined (reading 'sendMessage')"),
      ),
    ).toBe(true);
  });

  it('returns false for unrelated TypeError', () => {
    expect(isContextInvalidated(new TypeError('foo is not a function'))).toBe(false);
  });

  it('returns false for unrelated errors', () => {
    expect(isContextInvalidated(new Error('Network error'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isContextInvalidated('Extension context invalidated')).toBe(false);
    expect(isContextInvalidated(null)).toBe(false);
    expect(isContextInvalidated(undefined)).toBe(false);
    expect(isContextInvalidated(42)).toBe(false);
  });
});

describe('markContextInvalidated / isMarkedInvalidated', () => {
  async function freshModule() {
    const mod = await import('@/entrypoints/content/context-invalidated');
    return mod;
  }

  it('isMarkedInvalidated returns false by default', async () => {
    const mod = await freshModule();
    expect(mod.isMarkedInvalidated()).toBe(false);
  });

  it('isMarkedInvalidated returns true after markContextInvalidated', async () => {
    const mod = await freshModule();
    mod.markContextInvalidated();
    expect(mod.isMarkedInvalidated()).toBe(true);
  });

  it('markContextInvalidated is idempotent', async () => {
    const mod = await freshModule();
    mod.markContextInvalidated();
    mod.markContextInvalidated();
    expect(mod.isMarkedInvalidated()).toBe(true);
  });
});
