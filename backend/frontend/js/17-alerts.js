/* 17-alerts.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен.
   18.6 Alerts 2.0: полный жизненный цикл алерта (не только open->acked),
   тот же паттерн, что страница «Задачи» (15-tasks.js). */

let alertsFilter = 'open';

const ALERT_STATUS_LABEL = {
  open: 'Новый',
  acked: 'Принят',
  in_progress: 'В работе',
  resolved: 'Решён',
  dismissed: 'Не актуален'
};

function setAlertsFilter(f) {
  alertsFilter = f;
  loadAlertsPage();
}

async function loadAlertsPage() {
  const box = document.getElementById('alertsPageBody');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await fetch(API + '/alerts?status=' + alertsFilter + orgQueryParam(), { headers: authHeaders() });
    if (!res.ok) throw new Error('fail');
    const items = await res.json();

    box.innerHTML = `
      <div class="quick" style="padding:0 16px 10px;flex-wrap:wrap">
        ${['open', 'in_progress', 'resolved', 'dismissed'].map(s =>
          `<button class="${alertsFilter === s ? 'active' : ''}" onclick="setAlertsFilter('${s}')">${ALERT_STATUS_LABEL[s]}</button>`
        ).join('')}
      </div>
      <div style="padding:0 16px 16px">
        ${items.length ? items.map(a => `
          <button class="row" onclick="openAlertDetail(${a.id})">
            <div class="row-icon">${a.severity === 'critical' ? '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M7 18v-6a5 5 0 1 1 10 0v6" /> <path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z" /> <path d="M21 12h1" /> <path d="M18.5 4.5 18 5" /> <path d="M2 12h1" /> <path d="M12 2v1" /> <path d="m4.929 4.929.707.707" /> <path d="M12 12v6" /> </svg>' : '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" /> </svg>'}</div>
            <div class="row-body">
              <div class="row-title">${esc(a.title)}</div>
              <div class="row-sub">${esc(a.store_name || '')} · ${ALERT_STATUS_LABEL[a.status] || a.status}${a.task_id ? ' · есть задача' : ''}</div>
            </div>
            <div class="row-chevron">›</div>
          </button>`).join('') : '<div class="empty">Нет алертов</div>'}
      </div>`;
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить алерты</div>';
  }
}

async function openAlertDetail(id) {
  document.getElementById('modalTitle').textContent = 'Алерт';
  document.getElementById('modalBody').innerHTML = '<div class="skeleton"></div>';
  document.getElementById('overlay').classList.add('show');
  await renderAlertDetail(id);
}

async function renderAlertDetail(id) {
  const box = document.getElementById('modalBody');
  try {
    const res = await fetch(API + '/alerts?status=' + alertsFilter + orgQueryParam(), { headers: authHeaders() });
    const items = await res.json();
    let a = items.find(x => Number(x.id) === Number(id));
    if (!a) {
      // элемент мог уже уйти из текущего фильтра (сменился статус) —
      // достаточно контекста, чтобы просто показать кнопки перехода.
      a = { id, title: 'Алерт', status: alertsFilter };
    }

    const next = [];
    if (a.status !== 'in_progress' && a.status !== 'resolved' && a.status !== 'dismissed') {
      next.push(['in_progress', 'Взять в работу']);
    }
    if (a.status !== 'resolved') next.push(['resolved', 'Решено']);
    if (a.status !== 'dismissed') next.push(['dismissed', 'Не актуально']);

    box.innerHTML = `
      <div class="empty" style="text-align:left;padding:0 0 10px">
        <b>${esc(a.title)}</b>${a.body ? '<br>' + esc(a.body) : ''}
      </div>
      <div style="font-size:12px;color:var(--hint);margin-bottom:10px">
        ${esc(a.store_name || '')} · ${ALERT_STATUS_LABEL[a.status] || a.status}${a.created_at ? ' · ' + new Date(a.created_at).toLocaleString('ru') : ''}
      </div>
      ${a.task_id ? `<button class="row" onclick="openTaskDetail(${a.task_id})">
        <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /> <path d="M12 11h4" /> <path d="M12 16h4" /> <path d="M8 11h.01" /> <path d="M8 16h.01" /> </svg></div>
        <div class="row-body"><div class="row-title">Связанная задача</div><div class="row-sub">${a.task_status === 'done' ? 'Выполнена' : 'В работе'}</div></div>
        <div class="row-chevron">›</div>
      </button>` : ''}
      <div class="quick" style="margin-top:10px">
        ${next.map(([s, label]) => `<button onclick="changeAlertStatus(${a.id}, '${s}', this)">${label}</button>`).join('')}
      </div>
    `;
  } catch (e) {
    box.innerHTML = '<div class="empty">Не удалось загрузить алерт</div>';
  }
}

async function changeAlertStatus(id, status, btnEl) {
  if (btnEl?.disabled) return;
  if (btnEl) btnEl.disabled = true;
  try {
    const res = await fetch(API + '/alerts/' + id + '/status', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('fail');
    toast('Статус обновлён', 'ok');
    await renderAlertDetail(id);
    if (typeof page !== 'undefined' && page === 'alerts') loadAlertsPage();
  } catch (e) {
    toast('Не удалось изменить статус', 'err');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}
