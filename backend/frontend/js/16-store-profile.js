/* 16-store-profile.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен.
   18.5 Store Intelligence: профиль точки — план/факт/прогноз, тренд,
   staffing, кассовая дисциплина, связанные задачи/алерты, объяснимый
   Store Health Score. Conversion/Avg check намеренно нет — нет данных
   о трафике/деньгах, не выдумываем цифры (см. changelog 18.5.0). */

let currentStoreProfileId = null;

const HEALTH_COMPONENT_LABEL = {
  plan: 'План',
  trend: 'Темп дня',
  staffing: 'Штат',
  cash_discipline: 'Касса'
};

/* Точка входа (из live-map/Command Center) — переключает страницу, что сама
   же вызывает loadPage('store-profile') -> renderStoreProfile(). Не звать
   renderStoreProfile() напрямую из loadPage(), иначе switchPage() внутри
   неё вызовет loadPage() снова (рекурсия). */
function openStoreProfile(storeId) {
  currentStoreProfileId = storeId;
  switchPage('store-profile');
}

async function renderStoreProfile() {
  const storeId = currentStoreProfileId;
  if (!storeId) return;
  const box = document.getElementById('storeProfileBody');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await fetch(API + '/stores/' + encodeURIComponent(storeId) + '/profile?_=1' + orgQueryParam(), {
      headers: authHeaders()
    });
    if (!res.ok) throw new Error('fail');
    const d = await res.json();

    const tone = commandCenterTone(d.health?.score || 0);
    const comps = d.health?.components || {};
    const staff = (d.store?.staff || []).map(s => s.name || s.full_name || '').filter(Boolean).join(', ');

    const trend = Array.isArray(d.trend) ? d.trend : [];
    const trendHasData = trend.some(t => (t.units || 0) > 0);
    const trendMax = Math.max(1, ...trend.map(t => t.units || 0));

    window.__storeProfileDisplayName = d.store?.display_name || '';

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
          ${Object.keys(comps).map(k => `
            <div class="mchip" style="cursor:default">${HEALTH_COMPONENT_LABEL[k] || k}: ${comps[k].value}%</div>
          `).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Сегодня</div>
        <div style="padding:0 16px">
          ${['sim', 'mnp', 'pa', 'combo'].map(m => progressHTML(metricLabel(m), d.today?.metrics?.[m]?.fact, d.today?.metrics?.[m]?.plan)).join('')}
        </div>
      </div>

      ${trend.length ? `
      <div class="section">
        <div class="section-title">Тренд, юниты в день</div>
        ${trendHasData ? `
        <div style="padding:0 16px;display:flex;align-items:flex-end;gap:2px;height:60px">
          ${trend.map(t => `
            <div style="flex:1;background:var(--primary-soft);border-radius:2px 2px 0 0;height:${Math.max(4, Math.round((t.units || 0) / trendMax * 100))}%" title="${t.date}: ${t.units}"></div>
          `).join('')}
        </div>` : '<div class="empty">Нет продаж за период</div>'}
      </div>` : ''}

      ${(d.tasks || []).length ? `
      <div class="section">
        <div class="section-title">Задачи по точке</div>
        ${d.tasks.map(t => `
          <button class="row" onclick="openTaskDetail(${t.id})">
            <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /> <path d="M12 11h4" /> <path d="M12 16h4" /> <path d="M8 11h.01" /> <path d="M8 16h.01" /> </svg></div>
            <div class="row-body">
              <div class="row-title">${esc(t.title)}</div>
              <div class="row-sub">${esc(t.assignee_name || '')} · ${t.status === 'in_progress' ? 'В работе' : 'Открыта'}</div>
            </div>
            <div class="row-chevron">›</div>
          </button>`).join('')}
      </div>` : ''}

      ${(d.alerts || []).length ? `
      <div class="section">
        <div class="section-title">Алерты</div>
        <div style="padding:0 16px 16px">
          ${d.alerts.map(a => `<div class="sv-drop warn" style="margin:8px 0 0"><div class="ico"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" /> </svg></div><div class="s">${esc(a)}</div></div>`).join('')}
        </div>
      </div>` : ''}
    `;
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить профиль точки</div>';
  }
}

/* 7: кастомное название точки — перекрывает "сырое" name везде в мини-аппе
   (см. COALESCE(display_name, name) на бэкенде). Простой prompt() — поле
   одно текстовое, отдельная модалка была бы избыточной. */
async function editStoreDisplayName(storeId) {
  const current = window.__storeProfileDisplayName || '';
  const next = prompt('Кастомное название точки (пусто — вернуть обычное имя):', current);
  if (next === null) return;
  const trimmed = next.trim();
  try {
    const res = await fetch(API + '/stores/' + encodeURIComponent(storeId), {
      method: 'PATCH',
      headers: authHeaders(true),
      body: JSON.stringify({ display_name: trimmed || null })
    });
    if (!res.ok) throw new Error('fail');
    toast('Название обновлено', 'ok');
    renderStoreProfile();
  } catch (e) {
    toast('Ошибка сохранения', 'err');
  }
}
