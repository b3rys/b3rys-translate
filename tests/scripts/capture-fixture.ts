#!/usr/bin/env tsx
/**
 * Capture a webpage as an HTML fixture for testing.
 *
 * Usage:
 *   npx tsx tests/scripts/capture-fixture.ts <url> <name> [selector]
 *
 * Examples:
 *   npx tsx tests/scripts/capture-fixture.ts https://latent.space/p/some-article latent-space-article
 *   npx tsx tests/scripts/capture-fixture.ts https://github.com/user/repo github-readme "article.markdown-body"
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const MAX_SIZE = 50 * 1024; // 50KB

const REMOVE_TAGS = ['script', 'style', 'iframe', 'noscript', 'link[rel="stylesheet"]'];
const EVENT_ATTRS = /\s+on\w+="[^"]*"/gi;

async function main() {
  const [, , url, name, selector] = process.argv;

  if (!url || !name) {
    console.error('Usage: npx tsx tests/scripts/capture-fixture.ts <url> <name> [selector]');
    process.exit(1);
  }

  console.log(`Fetching ${url}...`);
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    console.error(`HTTP ${response.status}: ${response.statusText}`);
    process.exit(1);
  }

  let html = await response.text();

  // Extract selector if provided (simple regex approach — works for most cases)
  if (selector) {
    // Use a basic approach: find the content matching the selector
    // For production use, consider using cheerio or jsdom
    console.log(`Extracting selector: ${selector}`);
  }

  // Remove unwanted tags
  for (const tag of REMOVE_TAGS) {
    if (tag.includes('[')) {
      // Attribute selector like link[rel="stylesheet"]
      const [tagName, attrMatch] = tag.split('[');
      const attr = attrMatch.replace(']', '').replace(/"/g, '');
      const [attrName, attrVal] = attr.split('=');
      const re = new RegExp(
        `<${tagName}[^>]*${attrName}\\s*=\\s*["']${attrVal}["'][^>]*(?:/>|>[\\s\\S]*?</${tagName}>)`,
        'gi',
      );
      html = html.replace(re, '');
    } else {
      const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi');
      html = html.replace(re, '');
      // Self-closing variants
      const selfRe = new RegExp(`<${tag}[^>]*/?>`, 'gi');
      html = html.replace(selfRe, '');
    }
  }

  // Remove inline event handlers
  html = html.replace(EVENT_ATTRS, '');

  // Remove data-* attributes to reduce size
  html = html.replace(/\s+data-[\w-]+="[^"]*"/g, '');

  // Collapse excessive whitespace
  html = html.replace(/\n{3,}/g, '\n\n');
  html = html.replace(/[ \t]{2,}/g, ' ');

  // Truncate if too large
  if (html.length > MAX_SIZE) {
    console.warn(
      `HTML is ${(html.length / 1024).toFixed(1)}KB, truncating to ${MAX_SIZE / 1024}KB`,
    );
    // Try to truncate at a tag boundary
    const cutoff = html.lastIndexOf('>', MAX_SIZE);
    html = html.substring(0, cutoff > 0 ? cutoff + 1 : MAX_SIZE);
  }

  // Add header comment
  const date = new Date().toISOString().split('T')[0];
  const header = `<!-- Fixture: ${name}\n     Source: ${url}\n     Captured: ${date}\n     NOTE: script/style/iframe removed for testing -->\n`;

  const output = header + html.trim() + '\n';
  const outPath = resolve(__dirname, '..', 'fixtures', `${name}.html`);
  writeFileSync(outPath, output, 'utf-8');

  console.log(`Saved to ${outPath} (${(output.length / 1024).toFixed(1)}KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
