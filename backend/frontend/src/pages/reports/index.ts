/**
 * 20.12.0 (Frontend rewrite kickoff) — pilot page, replacing
 * frontend/js/19-reports.js file-for-file. Picked as the pilot: smallest
 * legacy page (71 lines), no page-local state, no cross-file DOM
 * dependencies beyond the nav shell.
 *
 * Integration: registers with app/router.ts AND assigns the same global
 * name (`window.loadReportsPage`) the legacy switchPage()/loadPage()
 * dispatch in 02-nav-utils.js already calls — that file is untouched,
 * zero risk to the 19 still-legacy pages sharing its if-chain.
 */
import { registerPage, renderPage } from '../../app/router.js';
import { bindSendDigestButtons } from '../../features/send-network-digest/index.js';
import type { OutcomeBucket } from '../../../../src/shared/api-types.js';

function reportImageRowHTML(): string {
  return `
    <div class="section">
      <div class="section-title">Отчёт по точке</div>
      <button class="row" onclick="switchPage('reportimg')">
        <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"> <rect width="18" height="18" x="3" y="3" rx="2" ry="2" /> <circle cx="9" cy="9" r="2" /> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /> </svg></div>
        <div class="row-body">
          <div class="row-title">Отчёт-картинка</div>
          <div class="row-sub">SVG итог дня по выбранной точке</div>
        </div>
        <div class="row-chevron">›</div>
      </button>
    </div>`;
}

function exportCsvSectionHTML(): string {
  const row = (kind: string, label: string) => `
      <button class="row" onclick="exportCSV('${kind}')">
        <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"> <path d="M12 15V3" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <path d="m7 10 5 5 5-5" /> </svg></div>
        <div class="row-body"><div class="row-title">${label}</div></div>
        <div class="row-chevron">›</div>
      </button>`;
  return `
    <div class="section">
      <div class="section-title">Экспорт CSV</div>
      ${row('sales', 'Продажи')}
      ${row('bfq', 'BFQ')}
      ${row('schedules', 'График')}
    </div>`;
}

// Learn (21.x) — сработала ли рекомендация: agg-сводка по всей сети,
// admin-only (эндпоинт сам это требует, gate здесь только чтобы не
// показывать пустой/403-блок остальным ролям).
const OUTCOME_LABEL: Record<string, string> = {
  recovered: 'исправилось',
  still_missed: 'не исправилось',
  recurred: 'повторилось'
};

function bucketRateHTML(label: string, bucket: OutcomeBucket): string {
  const entries = Object.entries(bucket).filter((e): e is [string, number] => (e[1] || 0) > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total) return `<div class="row-sub">${label}: пока нет данных</div>`;
  const parts = entries.map(([k, v]) => `${OUTCOME_LABEL[k] || k} ${v} (${Math.round((v / total) * 100)}%)`);
  return `<div class="row-sub">${label} (${total}): ${parts.join(' · ')}</div>`;
}

function typeEffectivenessHTML(title: string, data: { with_task: OutcomeBucket; without_task: OutcomeBucket }): string {
  return `
    <div style="margin-top:10px">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">${title}</div>
      ${bucketRateHTML('С выполненной задачей', data.with_task)}
      ${bucketRateHTML('Без задачи', data.without_task)}
    </div>`;
}

async function loadLearnSummary(box: HTMLElement) {
  try {
    const summary = await window.apiClient.getAlertsEffectiveness(authHeaders());
    box.innerHTML =
      typeEffectivenessHTML('Прогноз конца дня (plan_miss_projected)', summary.plan_miss_projected) +
      typeEffectivenessHTML('Просевшие дни (anomaly_vs_forecast)', summary.anomaly_vs_forecast);
  } catch {
    box.innerHTML = '<div class="row-sub">Не удалось загрузить</div>';
  }
}

function learnSummarySectionHTML(): string {
  return `
    <div class="section">
      <div class="section-title">Эффективность рекомендаций</div>
      <div class="empty" style="text-align:left;padding:0 16px 10px">
        Explain/Predict находят причину и предупреждают заранее, Recommend
        подсказывает действие в задаче — здесь видно, помогает ли это на
        самом деле: сравнение алертов с доведённой до конца задачей и без.
      </div>
      <div id="learnSummaryBody" style="padding:0 16px 16px">
        <div class="row-sub">Загрузка…</div>
      </div>
    </div>`;
}

function digestSectionHTML(canSend: boolean): string {
  return `
    <div class="section">
      <div class="section-title">Сводка по сети</div>
      <div class="empty" style="text-align:left;padding:0 16px 10px">
        Итог по сети (план/темп, лучшие и отстающие точки) — как ежедневные
        фото-отчёты по точке, только раз в неделю/месяц по всей сети.
      </div>
      ${canSend ? `
        <div style="padding:0 16px 16px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="mchip" data-digest-kind="weekly">Отправить недельную</button>
          <button class="mchip" data-digest-kind="monthly">Отправить месячную</button>
        </div>` : ''}
    </div>`;
}

export function renderReportsPage(): void {
  const box = document.getElementById('reportsPageBody');
  if (!box) return;
  const canSend = canManage();
  const isAdmin = me?.role === 'admin';

  box.innerHTML =
    digestSectionHTML(canSend) +
    reportImageRowHTML() +
    (canSend ? exportCsvSectionHTML() : '') +
    (isAdmin ? learnSummarySectionHTML() : '');

  bindSendDigestButtons(box);

  if (isAdmin) {
    const learnBox = document.getElementById('learnSummaryBody');
    if (learnBox) loadLearnSummary(learnBox);
  }
}

registerPage('reports', renderReportsPage);

declare global {
  interface Window {
    loadReportsPage: () => void;
  }
}
window.loadReportsPage = () => {
  renderPage('reports');
};
