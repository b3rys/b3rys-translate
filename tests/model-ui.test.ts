import { beforeEach, describe, expect, it } from 'vitest';
import { populateModelSelect, renderModelPricingTable } from '@/entrypoints/popup/model-ui';

describe('popup model UI', () => {
  beforeEach(() => {
    document.body.innerHTML = '<select id="models"></select><div id="pricing"></div>';
  });

  it('renders only the six model labels in the selector', () => {
    const select = document.getElementById('models') as HTMLSelectElement;
    populateModelSelect(select);

    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Gemini 3.1 Flash Lite',
      'GPT-5.4 Nano',
      'GPT-5.6 Luna',
      'Claude Haiku 4.5',
      'Claude Sonnet 4.6',
    ]);
  });

  it('renders model labels and prices without a description column', () => {
    const tooltip = document.getElementById('pricing') as HTMLElement;
    renderModelPricingTable(tooltip);

    expect(tooltip.textContent).toContain('GPT-5.6 Luna');
    expect(tooltip.textContent).toContain('Input / Output · USD per 1M tokens');
    expect(tooltip.textContent).not.toContain('저비용');
    expect(tooltip.textContent).not.toContain('고품질');
    expect(tooltip.querySelectorAll('th')).toHaveLength(2);
  });
});
