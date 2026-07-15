import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEBOUNCE_DELAY } from '@/utils/constants';

// Must import after mocking
import { observeDynamicContent } from '@/entrypoints/content/observer';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('observeDynamicContent', () => {
  it('ignores elements with data-b3rys-* attributes', async () => {
    const callback = vi.fn();
    const unsubscribe = observeDynamicContent(callback);

    const el = document.createElement('span');
    el.setAttribute('data-b3rys-translated', 'true');
    document.body.appendChild(el);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_DELAY + 50);
    expect(callback).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('ignores elements with b3rys-* class', async () => {
    const callback = vi.fn();
    const unsubscribe = observeDynamicContent(callback);

    const el = document.createElement('span');
    el.className = 'b3rys-translation';
    document.body.appendChild(el);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_DELAY + 50);
    expect(callback).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('calls callback for normal elements', async () => {
    const callback = vi.fn();
    const unsubscribe = observeDynamicContent(callback);

    const p = document.createElement('p');
    p.textContent = 'Hello world';
    document.body.appendChild(p);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_DELAY + 50);
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('debounces multiple rapid additions into a single callback', async () => {
    const callback = vi.fn();
    const unsubscribe = observeDynamicContent(callback);

    for (let i = 0; i < 5; i++) {
      const p = document.createElement('p');
      p.textContent = `Paragraph ${i}`;
      document.body.appendChild(p);
      // Small delay between additions but less than debounce
      await vi.advanceTimersByTimeAsync(50);
    }

    await vi.advanceTimersByTimeAsync(DEBOUNCE_DELAY + 50);
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('stops observing after unsubscribe', async () => {
    const callback = vi.fn();
    const unsubscribe = observeDynamicContent(callback);
    unsubscribe();

    const p = document.createElement('p');
    p.textContent = 'Hello world';
    document.body.appendChild(p);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_DELAY + 50);
    expect(callback).not.toHaveBeenCalled();
  });

  it('ignores text-only node additions', async () => {
    const callback = vi.fn();
    const unsubscribe = observeDynamicContent(callback);

    const text = document.createTextNode('Just text');
    document.body.appendChild(text);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_DELAY + 50);
    expect(callback).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('calls callback when mixed b3rys + normal elements are added', async () => {
    const callback = vi.fn();
    const unsubscribe = observeDynamicContent(callback);

    const b3rys = document.createElement('span');
    b3rys.setAttribute('data-b3rys-translated', 'true');
    document.body.appendChild(b3rys);

    const normal = document.createElement('p');
    normal.textContent = 'Normal content';
    document.body.appendChild(normal);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_DELAY + 50);
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
