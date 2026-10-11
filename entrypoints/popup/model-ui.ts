import { modelCatalog } from '@/utils/models';
import type { ModelCatalog } from '@/utils/model-catalog';

export function populateModelSelect(
  select: HTMLSelectElement,
  catalog: ModelCatalog = modelCatalog,
): void {
  select.replaceChildren();
  for (const model of catalog.models) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.label;
    select.appendChild(option);
  }
}

export function renderModelPricingTable(
  container: HTMLElement,
  catalog: ModelCatalog = modelCatalog,
): void {
  const title = document.createElement('div');
  title.className = 'info-tooltip-title';
  title.textContent = '모델 가격 · Input / Output · USD per 1M tokens';

  const table = document.createElement('table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['모델', '가격']) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  }
  head.appendChild(headRow);

  const body = document.createElement('tbody');
  for (const model of catalog.models) {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = model.label;
    const price = document.createElement('td');
    price.className = 'tt-price';
    price.textContent = `$${model.pricing.input.toFixed(2)}/${model.pricing.output.toFixed(2)}`;
    row.append(name, price);
    body.appendChild(row);
  }

  table.append(head, body);
  container.replaceChildren(title, table);
}
