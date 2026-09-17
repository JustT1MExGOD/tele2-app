/**
 * Admin Control Center, Phase 4+ (Area B3) — Business Rules (BFQ/metrics
 * catalog). Surfaces the existing GET/POST/DELETE /metrics routes — no
 * new backend, reuses features/cash-metrics/api.ts's getMetrics/
 * createMetric/deleteMetric, already exposed on window.apiClient.
 */
import type { MetricDef } from '../../../../src/shared/api-types.js';

export function renderBusinessRulesTab(container: HTMLElement): void {
  container.innerHTML = `
    <div class="section">
      <div class="section-title">Новая метрика</div>
      <div style="padding:0 16px 8px;display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="bruLabel" placeholder="Название" style="flex:1;min-width:120px">
        <input type="text" id="bruShort" placeholder="Короткое имя" style="flex:1;min-width:100px">
        <select id="bruUnit">
          <option value="count">шт</option>
          <option value="money">₽</option>
        </select>
        <button type="button" class="btn-main" id="bruAddBtn">Добавить</button>
      </div>
      <div id="adminMetricsList"></div>
    </div>
  `;

  document.getElementById('bruAddBtn')?.addEventListener('click', onCreateMetric);
  document.getElementById('adminMetricsList')?.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-delete-metric-id]');
    if (btn?.dataset.deleteMetricId) onDeleteMetric(btn.dataset.deleteMetricId);
  });

  loadMetrics();
}

async function loadMetrics(): Promise<void> {
  const box = document.getElementById('adminMetricsList');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.getMetrics(authHeaders());
    renderMetricsList(box, res.items);
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить метрики</div>';
  }
}

function renderMetricsList(box: HTMLElement, items: MetricDef[]): void {
  if (!items.length) {
    box.innerHTML = '<div class="empty">Метрик нет</div>';
    return;
  }
  box.innerHTML = items
    .map(
      (m) => `
      <div class="row" style="cursor:default">
        <div class="row-body">
          <div class="row-title">${esc(m.label)} (${esc(m.short_label)})</div>
          <div class="row-sub">${esc(m.id)} · ${esc(m.unit)}</div>
        </div>
        <button type="button" class="btn-ghost" data-delete-metric-id="${esc(m.id)}">Удалить</button>
      </div>`
    )
    .join('');
}

async function onCreateMetric(): Promise<void> {
  const label = (document.getElementById('bruLabel') as HTMLInputElement | null)?.value.trim() || '';
  const short = (document.getElementById('bruShort') as HTMLInputElement | null)?.value.trim() || undefined;
  const unit = (document.getElementById('bruUnit') as HTMLSelectElement | null)?.value || 'count';
  if (!label) {
    toast('Укажите название', 'err');
    return;
  }
  try {
    await window.apiClient.createMetric(authHeaders(), { label, short_label: short, unit });
    toast('Метрика добавлена', 'ok');
    loadMetrics();
  } catch (e) {
    toast('Ошибка добавления метрики', 'err');
  }
}

async function onDeleteMetric(id: string): Promise<void> {
  try {
    await window.apiClient.deleteMetric(authHeaders(), id);
    toast('Метрика удалена', 'ok');
    loadMetrics();
  } catch (e) {
    toast('Ошибка удаления (возможно, базовая метрика)', 'err');
  }
}
