/* 14-command-center.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен.
   18.1: единый экран manager/supervisor/admin — «что происходит / где
   проблема / что делать», собранный из /command-center вместо трёх
   отдельных экранов (dashboard-виджет / live-карта / кабинет супервайзера). */

async function loadCommandCenterPage() {
  const box = document.getElementById('ccPageBody');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await fetch(API + '/command-center?_=1' + orgQueryParam(), { headers: authHeaders() });
    if (!res.ok) throw new Error('fail');
    const d = await res.json();

    const health = Number(d.network?.health) || 0;
    const tone = commandCenterTone(health);
    const pace = Number(d.network?.pace_delta) || 0;
    const paceText = (pace >= 0 ? '+' : '') + pace + '% к темпу дня';
    const problems = Array.isArray(d.problems) ? d.problems : [];
    const stores = Array.isArray(d.stores) ? d.stores : [];

    box.innerHTML = `
      <div class="section">
        <div class="section-title">Что происходит</div>
        <div class="cc-row" style="padding:0 16px">
          <div class="cc-health ${tone}">${health}</div>
          <div class="cc-meta">
            <div class="cc-line"><b>${d.network?.overall_pct || 0}%</b> план дня · ${d.network?.staff_on_shift || 0} на смене · ${d.network?.stores_count || 0} точек</div>
            <div class="cc-line cc-${pace >= 0 ? 'up' : 'down'}">${paceText}</div>
          </div>
        </div>
        <div style="padding:10px 16px 0">
          ${stores.map(st => `
            <div class="progress-block" style="margin-bottom:8px;border-left:4px solid ${st.color || '#2AABEE'}">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <strong>${esc(st.name)}</strong>
                <span style="font-weight:700">${st.today?.overall ?? 0}%</span>
              </div>
              <div style="font-size:12px;color:var(--hint);margin-top:4px">
                ${st.staff_count || 0} на смене · SIM ${st.today?.sim || 0}/${st.today?.plan_sim || 0} · MNP ${st.today?.mnp || 0}/${st.today?.plan_mnp || 0}
              </div>
            </div>`).join('') || '<div class="empty">Нет точек в сети</div>'}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Где проблема ${problems.length ? `(${problems.length})` : ''}</div>
        <div style="padding:0 16px 16px">
          ${problems.length ? problems.map(p => `
            <div class="sv-drop ${p.severity === 'critical' ? '' : 'warn'}" style="margin:8px 0 0">
              <div class="ico">${p.severity === 'critical' ? '🚨' : '⚠️'}</div>
              <div style="flex:1">
                <div class="t">${esc(p.store_name || 'Точка')}</div>
                <div class="s">${esc(p.message || '')}</div>
                ${p.ai_comment ? `<div class="s" style="margin-top:4px;font-style:italic">🤖 ${esc(p.ai_comment)}</div>` : ''}
                <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                  ${(p.actions || []).map(a => ccActionButton(a)).join('')}
                </div>
              </div>
            </div>`).join('') : '<div class="empty" style="padding:10px 0 0">Проблем нет — сеть в ритме</div>'}
        </div>
      </div>

      ${canAdmin() || (typeof me !== 'undefined' && me?.role === 'supervisor') ? `
        <div class="section">
          <button class="row" onclick="enterSupervisorShell()">
            <div class="row-icon">📊</div>
            <div class="row-body">
              <div class="row-title">Полная аналитика сектора</div>
              <div class="row-sub">Тренд · топ продавцов · разбивка по точкам</div>
            </div>
            <div class="row-chevron">›</div>
          </button>
        </div>` : ''}
    `;
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Command Center сейчас недоступен, зайди чуть позже</div>';
  }
}

/* «Что делать» — действие ведёт к уже существующему экрану, ничего
   нового не открываем: open_employee → карточка сотрудника (уже везде
   используется), open_store → живая карта (полноценной detail-страницы
   точки в проекте нет, не изобретаем её здесь). */
function ccActionButton(action) {
  if (action.type === 'open_employee') {
    return `<button class="mchip" onclick="openEmployeeCard(${action.id})">Открыть сотрудника</button>`;
  }
  if (action.type === 'open_store') {
    return `<button class="mchip" onclick="switchPage('live')">Открыть точку</button>`;
  }
  return '';
}
