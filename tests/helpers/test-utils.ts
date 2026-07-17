import { readFileSync } from 'fs';
import { resolve } from 'path';

const FIXTURES_DIR = resolve(__dirname, '..', 'fixtures');

/** Load an HTML (or JSON) fixture by name (with or without extension). */
export function loadFixture(name: string): string {
  // Support both 'foo' and 'foo.html'
  const hasExt = /\.\w+$/.test(name);
  const filename = hasExt ? name : `${name}.html`;
  return readFileSync(resolve(FIXTURES_DIR, filename), 'utf-8');
}

/** Create a container div with the given HTML and append to document.body. */
export function setupDOM(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

/** Flush microtask queue (resolved promises). */
export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
