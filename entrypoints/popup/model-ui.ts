import { MODEL_CATALOG } from '@/utils/models';

export function populateModelSelect(select: HTMLSelectElement): void {
  select.replaceChildren();
  for (const model of MODEL_CATALOG) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.label;
    select.appendChild(option);
  }
}

export function renderModelPricingTable(container: HTMLElement): void {
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
  for (const model of MODEL_CATALOG) {
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
