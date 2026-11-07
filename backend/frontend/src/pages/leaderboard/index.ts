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
    body.innerHTML = `<div class="empty-state">
      <div class="es-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg></div>
      <div class="es-title">Каталог метрик пуст</div>
      <div class="es-sub">Настройте метрики плана, чтобы увидеть топ</div>
    </div>`;
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

function u3Initials(name: string): string {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** «Игорь Смирнов» → «Игорь С.» (подиум, как в концепте). */
function u3ShortName(name: string): string {
  const [a, b] = String(name || '').trim().split(/\s+/);
  return b ? `${a} ${b[0]}.` : a || '';
}

function renderList(body: HTMLElement, res: LeaderboardResponse): void {
  if (!res.items.length) {
    body.innerHTML = `<div class="empty-state">
      <div class="es-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg></div>
      <div class="es-title">Пока нет продаж за выбранный период</div>
      <div class="es-sub">Данные появятся после первых продаж</div>
    </div>`;
    return;
  }
  const max = res.items[0].value || 1;
  const unitSuffix = res.metric.unit === 'money' ? ' ₽' : '';
  // API отдаёт 'count' | 'money'; человекочитаемая единица — из каталога
  // метрик (window.METRICS: «шт» / «₽»), иначе по типу.
  const catalogUnit = (window.METRICS || []).find((m) => m.id === res.metric.id)?.unit || '';
  const unit = catalogUnit || (res.metric.unit === 'money' ? '₽' : 'шт');

  // Beta UI 3.0 «Ночная смена» — подиум 2-1-3 и список ячейками. Блоки
  // с атрибутом hidden невидимы в legacy, ui3/plans-rating.css показывает
  // их и прячет legacy-вертикальные бары (toggle без перерисовки).
  const myId = me?.employee_id != null ? String(me.employee_id) : '';
  const meIdx = res.items.findIndex((it) => String(it.employee_id) === myId);
  const podiumItems = res.items.slice(0, 3);
  const podOrder = [1, 0, 2];
  const podium =
    podiumItems.length >= 3
      ? `<div class="u3-only u3-podium" hidden>${podOrder
          .map((i) => {
            const it = podiumItems[i];
            const mine = i === meIdx;
            return `<div class="u3-pod${i === 0 ? ' first' : ''}${mine ? ' me' : ''}">
              <span class="u3-pod-rank">${it.rank} место</span>
              <span class="u3-avatar${i === 0 || mine ? ' acc' : ''}">${esc(u3Initials(it.full_name))}</span>
              <span class="u3-pod-name" title="${esc(it.full_name)}">${esc(u3ShortName(it.full_name))}</span>
              <span class="u3-pod-val">${it.value}${unitSuffix}</span>
            </div>`;
          })
          .join('')}</div>`
      : '';
  const cells = res.items
    .map((it) => {
      const mine = String(it.employee_id) === myId;
      return `<div class="u3-only u3-cell${mine ? ' me' : ''}"${mine ? ' aria-current="true"' : ''} hidden>
        <span class="u3-rank">${it.rank}</span>
        <span class="u3-avatar${mine ? ' acc' : ''}">${esc(u3Initials(it.full_name))}</span>
        <span class="u3-c-main"><span class="u3-c-t">${mine ? 'Вы, ' + esc(it.full_name) : esc(it.full_name)}</span></span>
        <span class="u3-c-r">${it.value.toLocaleString('ru-RU')}<span class="u3-c-s">${esc(unit)}</span></span>
      </div>`;
    })
    .join('');
  const gap =
    meIdx > 0
      ? `<p class="u3-only u3-gap-note" hidden>До ${res.items[meIdx - 1].rank} места не хватает <b>${(res.items[meIdx - 1].value - res.items[meIdx].value).toLocaleString('ru-RU')}${unitSuffix ? ' ' + unitSuffix.trim() : ''}</b></p>`
      : meIdx === 0
        ? '<p class="u3-only u3-gap-note" hidden>Вы на <b>1 месте</b></p>'
        : '';
  const u3 = `${podium}<div class="u3-only u3-group" hidden>${cells}</div>${gap}`;

  const legacy = `<div class="progress-block u3-legacy">${res.items
    .map((item) => {
      const pct = Math.max(2, Math.round((item.value / max) * 100));
      return `
        <div class="progress-item${String(item.employee_id) === myId ? ' me' : ''}">
          <div class="progress-top">
            <span class="name">${item.rank}. ${esc(item.full_name)}</span>
            <span class="val">${item.value}${unitSuffix}</span>
          </div>
          <div class="bar"><i style="width:${pct}%"></i></div>
        </div>`;
    })
    .join('')}</div>`;
  body.innerHTML = u3 + legacy;
}

declare global {
  interface Window {
    loadLeaderboard: typeof loadLeaderboard;
  }
}
window.loadLeaderboard = loadLeaderboard;
