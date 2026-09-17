/**
 * Admin Control Center (Phase 4+) — Plan Corrections tab. No void, no
 * step-up (see core/admin/plan-correction.ts's header comment) — just
 * single-metric correct for employee/store month plans. No search route
 * exists for plans (only GET by id), so lookup is by plan id directly,
 * same load → metric-chips structure as sales-correction.ts's detail view.
 */
import { promptMetricCorrection } from './shared/dialogs.js';

export function renderPlanCorrectionTab(container: HTMLElement): void {
  container.innerHTML = `
    <div class="section">
      <div class="section-title">План сотрудника</div>
      <div style="padding:0 16px 8px;display:flex;gap:8px">
        <input type="number" id="employeePlanId" placeholder="ID плана сотрудника" style="flex:1">
        <button type="button" class="btn-ghost" id="employeePlanLoadBtn">Открыть</button>
      </div>
      <div id="adminEmployeePlanDetail"></div>
    </div>
    <div class="section">
      <div class="section-title">План точки</div>
      <div style="padding:0 16px 8px;display:flex;gap:8px">
        <input type="number" id="storePlanId" placeholder="ID плана точки" style="flex:1">
        <button type="button" class="btn-ghost" id="storePlanLoadBtn">Открыть</button>
      </div>
      <div id="adminStorePlanDetail"></div>
    </div>
  `;

  document.getElementById('employeePlanLoadBtn')?.addEventListener('click', () => {
    const id = Number((document.getElementById('employeePlanId') as HTMLInputElement | null)?.value);
    if (id) renderEmployeePlanDetail(id);
  });
  document.getElementById('storePlanLoadBtn')?.addEventListener('click', () => {
    const id = Number((document.getElementById('storePlanId') as HTMLInputElement | null)?.value);
    if (id) renderStorePlanDetail(id);
  });
}

async function renderEmployeePlanDetail(planId: number): Promise<void> {
  const box = document.getElementById('adminEmployeePlanDetail');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const d = await window.apiClient.adminGetEmployeePlan(authHeaders(), planId);
    renderPlanMetrics(box, d, (metricId, label, currentValue) =>
      onCorrectEmployeePlanMetric(planId, d.row.version as number, metricId, label, currentValue)
    );
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить план</div>';
  }
}

async function renderStorePlanDetail(planId: number): Promise<void> {
  const box = document.getElementById('adminStorePlanDetail');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const d = await window.apiClient.adminGetStorePlan(authHeaders(), planId);
    renderPlanMetrics(box, d, (metricId, label, currentValue) =>
      onCorrectStorePlanMetric(planId, d.row.version as number, metricId, label, currentValue)
    );
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить план</div>';
  }
}

function renderPlanMetrics(
  box: HTMLElement,
  d: { row: Record<string, unknown>; metrics: Record<string, { value: number; label: string }> },
  onChipClick: (metricId: string, label: string, currentValue: number) => void
): void {
  const metrics = Object.entries(d.metrics)
    .map(
      ([metricId, m]) =>
        `<button type="button" class="mchip" data-metric-id="${esc(metricId)}" data-metric-value="${esc(String(m.value))}" style="cursor:pointer">${esc(m.label)}: ${esc(String(m.value))}</button>`
    )
    .join(' ');

  box.innerHTML = `<div id="planMetricChips" style="padding:8px 0;display:flex;gap:6px;flex-wrap:wrap">${metrics || '<span class="empty">нет метрик</span>'}</div>`;

  box.querySelector('#planMetricChips')?.addEventListener('click', (e) => {
    const chip = (e.target as Element | null)?.closest<HTMLElement>('[data-metric-id]');
    if (!chip) return;
    const metricId = chip.dataset.metricId!;
    const currentValue = Number(chip.dataset.metricValue) || 0;
    const label = d.metrics[metricId]?.label || metricId;
    onChipClick(metricId, label, currentValue);
  });
}

async function onCorrectEmployeePlanMetric(planId: number, version: number, metricId: string, label: string, currentValue: number): Promise<void> {
  const result = await promptMetricCorrection({ label, currentValue });
  if (result === null) return;
  try {
    await window.apiClient.adminCorrectEmployeePlanMetric(authHeaders(true), planId, metricId, result.value, version, result.reason);
    toast('Метрика изменена', 'ok');
    renderEmployeePlanDetail(planId);
  } catch (e) {
    toast('Ошибка (возможно, версия устарела)', 'err');
  }
}

async function onCorrectStorePlanMetric(planId: number, version: number, metricId: string, label: string, currentValue: number): Promise<void> {
  const result = await promptMetricCorrection({ label, currentValue });
  if (result === null) return;
  try {
    await window.apiClient.adminCorrectStorePlanMetric(authHeaders(true), planId, metricId, result.value, version, result.reason);
    toast('Метрика изменена', 'ok');
    renderStorePlanDetail(planId);
  } catch (e) {
    toast('Ошибка (возможно, версия устарела)', 'err');
  }
}
