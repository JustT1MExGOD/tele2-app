/**
 * 21.x (Frontend rewrite continuation) — fifth migrated legacy page,
 * replacing frontend/js/16-store-profile.js file-for-file. Same shape as
 * employee-profile: legacy nav dispatch (02-nav-utils.js) calls this page
 * by its bare legacy name (renderStoreProfile(), no `load` prefix), so
 * the window bridge matches that name directly.
 *
 * openStoreProfile(storeId) is the entry point OTHER legacy files call
 * (11-v13.js, 14-command-center.js) — bridged onto window.*, those
 * callers are untouched. It only sets state + switchPage(), same
 * anti-recursion reason as the legacy original and as employee-profile.
 *
 * window.__storeProfileDisplayName was the legacy file's own workaround
 * for passing the "current name" into editStoreDisplayName()'s prompt()
 * across two separately-onclick'd functions sharing classic-script global
 * scope — confirmed nothing OUTSIDE this file ever read it. A real TS
 * module doesn't need that workaround: a private module-level variable
 * does the same job without the window property, so it's dropped here
 * rather than carried forward as dead ceremony.
 *
 * Found and fixed a real backend bug while migrating: StoreProfileResponse
 * never actually had display_name (buildSupervisorDashboard() computes it,
 * but the route's own response object forgot to include it) — the rename
 * prompt's "current name" was always blank. Fixed server-side (see
 * src/api/routes/profiles/store.ts), not worked around here.
 */
import { registerPage, renderPage } from '../../app/router.js';

let currentStoreProfileId: string | null = null;
let currentStoreDisplayName = '';

const HEALTH_COMPONENT_LABEL: Record<string, string> = {
  plan: 'План',
  trend: 'Темп дня',
  staffing: 'Штат',
  cash_discipline: 'Касса'
};

export function openStoreProfile(storeId: string): void {
  currentStoreProfileId = storeId;
  switchPage('store-profile');
}

export async function renderStoreProfilePage(): Promise<void> {
  const storeId = currentStoreProfileId;
  if (!storeId) return;
  const box = document.getElementById('storeProfileBody');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const d: any = await window.apiClient.getStoreProfile(authHeaders(), storeId, orgQueryParam());

    const tone = commandCenterTone(d.health?.score || 0);
    const comps: Record<string, { value: number }> = d.health?.components || {};
    const staff = (d.store?.staff || [])
      .map((s: any) => s.name || s.full_name || '')
      .filter(Boolean)
      .join(', ');

    const trend: any[] = Array.isArray(d.trend) ? d.trend : [];
    const trendHasData = trend.some((t) => (t.units || 0) > 0);
    const trendMax = Math.max(1, ...trend.map((t) => t.units || 0));

    currentStoreDisplayName = d.store?.display_name || '';

    box.innerHTML = `
      <div class="section">
        <div class="section-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span>${esc(d.store?.name || 'Точка')}</span>
          ${canManage() ? `<button class="mchip" onclick="editStoreDisplayName('${storeId}')"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /> <path d="m15 5 4 4" /> </svg> Название</button>` : ''}
        </div>
        <div class="cc-row" style="padding:0 16px">
          <div class="cc-health ${tone}">${d.health?.score ?? 0}</div>
          <div class="cc-meta">
            <div class="cc-line">${d.store?.staff_count || 0} на смене сегодня${staff ? ': ' + esc(staff) : ''}</div>
          </div>
        </div>
        <div style="padding:10px 16px 4px;display:flex;gap:8px;flex-wrap:wrap">
          ${Object.keys(comps)
            .map(
              (k) => `
            <div class="mchip" style="cursor:default">${HEALTH_COMPONENT_LABEL[k] || k}: ${comps[k].value}%</div>
          `
            )
            .join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Сегодня</div>
        <div style="padding:0 16px">
          ${['sim', 'mnp', 'pa', 'combo'].map((m) => progressHTML(metricLabel(m), d.today?.metrics?.[m]?.fact, d.today?.metrics?.[m]?.plan)).join('')}
        </div>
      </div>

      ${
        trend.length
          ? `
      <div class="section">
        <div class="section-title">Тренд, юниты в день</div>
        ${
          trendHasData
            ? `
        <div style="padding:0 16px;display:flex;align-items:flex-end;gap:2px;height:60px">
          ${trend
            .map(
              (t) => `
            <div style="flex:1;background:var(--primary-soft);border-radius:2px 2px 0 0;height:${Math.max(4, Math.round(((t.units || 0) / trendMax) * 100))}%" title="${t.date}: ${t.units}"></div>
          `
            )
            .join('')}
        </div>`
            : '<div class="empty">Нет продаж за период</div>'
        }
      </div>`
          : ''
      }

      ${
        (d.tasks || []).length
          ? `
      <div class="section">
        <div class="section-title">Задачи по точке</div>
        ${d.tasks
          .map(
            (t: any) => `
          <button class="row" onclick="openTaskDetail(${t.id})">
            <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /> <path d="M12 11h4" /> <path d="M12 16h4" /> <path d="M8 11h.01" /> <path d="M8 16h.01" /> </svg></div>
            <div class="row-body">
              <div class="row-title">${esc(t.title)}</div>
              <div class="row-sub">${esc(t.assignee_name || '')} · ${t.status === 'in_progress' ? 'В работе' : 'Открыта'}</div>
            </div>
            <div class="row-chevron">›</div>
          </button>`
          )
          .join('')}
      </div>`
          : ''
      }

      ${
        (d.alerts || []).length
          ? `
      <div class="section">
        <div class="section-title">Алерты</div>
        <div style="padding:0 16px 16px">
          ${d.alerts.map((a: string) => `<div class="sv-drop warn" style="margin:8px 0 0"><div class="ico"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" /> </svg></div><div class="s">${esc(a)}</div></div>`).join('')}
        </div>
      </div>`
          : ''
      }
    `;
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить профиль точки</div>';
  }
}

export async function editStoreDisplayName(storeId: string): Promise<void> {
  const next = prompt('Кастомное название точки (пусто — вернуть обычное имя):', currentStoreDisplayName);
  if (next === null) return;
  const trimmed = next.trim();
  try {
    await window.apiClient.updateStoreDisplayName(authHeaders(true), storeId, trimmed || null);
    toast('Название обновлено', 'ok');
    renderStoreProfilePage();
  } catch (e) {
    toast('Ошибка сохранения', 'err');
  }
}

registerPage('store-profile', renderStoreProfilePage);

declare global {
  interface Window {
    openStoreProfile: typeof openStoreProfile;
    renderStoreProfile: () => void;
    editStoreDisplayName: typeof editStoreDisplayName;
  }
}
window.openStoreProfile = openStoreProfile;
window.renderStoreProfile = () => {
  renderPage('store-profile');
};
window.editStoreDisplayName = editStoreDisplayName;
