/* 18-employee-profile.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен.
   18.8 Employee 2.0: профиль сотрудника — BFQ, геймификация, история смен,
   объяснимый Employee Health Score. Ничего не пересчитывает заново —
   собирает calculateEmployeeBFQ/getGamificationProfile в одном месте,
   тот же приём, что Store Intelligence (16-store-profile.js). */

let currentEmployeeProfileId = null;

const EMPLOYEE_HEALTH_COMPONENT_LABEL = {
  plan: 'План',
  ideal_shift_rate: 'Идеальные смены',
  attendance: 'Явка',
  momentum: 'Стабильность'
};

/* Точка входа (из карточки Команды/Command Center) — тот же приём, что
   openStoreProfile: переключает страницу, switchPage() сама вызывает
   loadPage('employee-profile') -> renderEmployeeProfile(). Не звать
   renderEmployeeProfile() напрямую отсюда — рекурсия через switchPage. */
function openEmployeeProfile(employeeId) {
  currentEmployeeProfileId = employeeId;
  switchPage('employee-profile');
}

async function renderEmployeeProfile() {
  const employeeId = currentEmployeeProfileId;
  if (!employeeId) return;
  const box = document.getElementById('employeeProfileBody');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await fetch(API + '/employees/' + encodeURIComponent(employeeId) + '/profile?_=1' + orgQueryParam(), {
      headers: authHeaders()
    });
    if (!res.ok) throw new Error('fail');
    const d = await res.json();

    const tone = commandCenterTone(d.health?.score || 0);
    const comps = d.health?.components || {};
    const gam = d.gamification || {};
    const bfq = d.bfq || {};
    const shifts = (d.shifts && d.shifts.recent) || [];
    const scoreMax = Math.max(1, ...shifts.map(s => Number(s.score) || 0));

    box.innerHTML = `
      <div class="section">
        <div class="section-title">${esc(d.employee?.full_name || 'Сотрудник')}</div>
        <div class="cc-row" style="padding:0 16px">
          <div class="cc-health ${tone}">${d.health?.score ?? 0}</div>
          <div class="cc-meta">
            <div class="cc-line">${gam.title || ''} · ур. ${gam.level || 1}</div>
          </div>
        </div>
        <div style="padding:10px 16px 4px;display:flex;gap:8px;flex-wrap:wrap">
          ${Object.keys(comps).map(k => `
            <div class="mchip" style="cursor:default">${EMPLOYEE_HEALTH_COMPONENT_LABEL[k] || k}: ${comps[k].value}%</div>
          `).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">BFQ за месяц</div>
        <div style="padding:0 16px 8px;display:flex;gap:8px;flex-wrap:wrap">
          <div class="mchip" style="cursor:default">Факт: ${bfq.fact?.total ?? 0}</div>
          <div class="mchip" style="cursor:default">Прогноз: ${bfq.forecast?.total ?? 0}</div>
          <div class="mchip" style="cursor:default">Смены: ${bfq.shifts?.worked ?? 0}/${(bfq.shifts?.worked || 0) + (bfq.shifts?.remaining || 0)}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Прогресс</div>
        <div style="padding:0 16px;display:flex;gap:8px;flex-wrap:wrap">
          <div class="mchip" style="cursor:default">XP: ${gam.xp || 0}${gam.next_level_xp != null ? ' / ' + gam.next_level_xp : ''}</div>
          <div class="mchip" style="cursor:default">🔥 ${gam.streak_days || 0} дн.</div>
          <div class="mchip" style="cursor:default">Лучшая смена: ${gam.best_shift_score || 0}</div>
        </div>
        ${(gam.badges || []).length ? `
        <div style="padding:8px 16px 0;display:flex;gap:6px;flex-wrap:wrap">
          ${gam.badges.map(b => `<div class="mchip" style="cursor:default">🏅 ${esc(b.title || b.badge_code)}</div>`).join('')}
        </div>` : ''}
      </div>

      ${shifts.length ? `
      <div class="section">
        <div class="section-title">Смены за период (score)</div>
        <div style="padding:0 16px;display:flex;align-items:flex-end;gap:2px;height:60px">
          ${shifts.slice().reverse().map(s => `
            <div style="flex:1;background:var(--primary-soft);border-radius:2px 2px 0 0;height:${Math.max(4, Math.round((Number(s.score) || 0) / scoreMax * 100))}%" title="${s.date}: ${s.score}${s.ideal_shift ? ' ⭐' : ''}"></div>
          `).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Последние смены</div>
        ${shifts.map(s => `
          <div class="row" style="cursor:default">
            <div class="row-icon">${s.ideal_shift ? '⭐' : '📅'}</div>
            <div class="row-body">
              <div class="row-title">${esc(s.date)} · ${esc(s.store_name || s.store_id || '')}</div>
              <div class="row-sub">score ${s.score ?? 0}${s.mood ? ' · настроение ' + s.mood + '/5' : ''}</div>
            </div>
          </div>`).join('')}
      </div>` : '<div class="section"><div class="empty">Нет закрытых смен за период</div></div>'}
    `;
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить профиль сотрудника</div>';
  }
}
