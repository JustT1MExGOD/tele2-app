/**
 * «Топы сотрудников» (20.75.0) — отдельный топ по каждой метрике каталога
 * (SIM отдельно, аксессуары отдельно, телефоны отдельно и т.д.), не один
 * сводный score (такой уже есть на вкладке супервайзера). Видно всем
 * ролям (backend — requireActive), своя сеть по умолчанию, admin может
 * явно переключиться через уже существующий org-switcher
 * (window.adminViewOrgId/orgQueryParam()) — переключение сети вызывает
 * window.loadPage(window.page), который снова зовёт loadLeaderboard().
 * Метрики — window.METRICS (тот же каталог, что GET /metrics уже грузит
 * в bootApp() через loadMetricsCatalog()), без отдельного запроса здесь.
 */
import { renderLoadError } from '../../shared/load-error.js';
import type { LeaderboardResponse } from '../../../../src/shared/api-types.js';

let currentMetric: string | null = null;
let wired = false;

function defaultFrom(): string {
  return todayMoscow().slice(0, 8) + '01';
}

export async function loadLeaderboard(): Promise<void> {
  const tabsBox = document.getElementById('leaderboardMetricTabs');
  const body = document.getElementById('leaderboardBody');
  const fromInput = document.getElementById('lbFrom') as HTMLInputElement | null;
  const toInput = document.getElementById('lbTo') as HTMLInputElement | null;
  if (!tabsBox || !body || !fromInput || !toInput) return;

  if (!fromInput.value) fromInput.value = defaultFrom();
  if (!toInput.value) toInput.value = todayMoscow();

  const metrics = window.METRICS || [];
  if (!currentMetric || !metrics.some((m) => m.id === currentMetric)) {
    currentMetric = metrics[0]?.id || null;
  }

  tabsBox.innerHTML = metrics
    .map((m) => `<button type="button" class="btn-ghost${m.id === currentMetric ? ' active' : ''}" data-leaderboard-metric="${esc(m.id)}">${esc(m.label)}</button>`)
    .join('');

  if (!wired) {
    wired = true;
    tabsBox.addEventListener('click', (e) => {
      const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-leaderboard-metric]');
      const metric = btn?.dataset.leaderboardMetric;
      if (metric && metric !== currentMetric) {
        currentMetric = metric;
        loadLeaderboard();
      }
    });
    fromInput.addEventListener('change', () => loadLeaderboard());
    toInput.addEventListener('change', () => loadLeaderboard());
  }

  if (!currentMetric) {
    body.innerHTML = '<div class="empty">Каталог метрик пуст</div>';
    return;
  }

  body.innerHTML = '<div class="skeleton"></div>';
  try {
    const res: LeaderboardResponse = await window.apiClient.getLeaderboard(authHeaders(), orgQueryParam(), currentMetric, fromInput.value, toInput.value);
    renderList(body, res);
  } catch (e) {
    console.error(e);
    renderLoadError(body, 'Не удалось загрузить топ', () => loadLeaderboard());
  }
}

function renderList(body: HTMLElement, res: LeaderboardResponse): void {
  if (!res.items.length) {
    body.innerHTML = '<div class="empty">Пока нет продаж за выбранный период</div>';
    return;
  }
  const max = res.items[0].value || 1;
  const unitSuffix = res.metric.unit === 'money' ? ' ₽' : '';
  body.innerHTML = `<div class="progress-block">${res.items
    .map((item) => {
      const pct = Math.max(2, Math.round((item.value / max) * 100));
      return `
        <div class="progress-item">
          <div class="progress-top">
            <span class="name">${item.rank}. ${esc(item.full_name)}</span>
            <span class="val">${item.value}${unitSuffix}</span>
          </div>
          <div class="bar"><i style="width:${pct}%"></i></div>
        </div>`;
    })
    .join('')}</div>`;
}

declare global {
  interface Window {
    loadLeaderboard: typeof loadLeaderboard;
  }
}
window.loadLeaderboard = loadLeaderboard;
