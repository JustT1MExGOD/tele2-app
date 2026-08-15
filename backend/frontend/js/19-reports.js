/* 19-reports.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен.
   18.9 Reports: единая страница «Отчёты» — не переизобретает уже готовое
   (SVG-отчёт по точке, CSV-экспорт), а собирает его в одном месте плюс
   новая недельная/месячная сводка по сети, которой раньше не было вообще. */

function loadReportsPage() {
  const box = document.getElementById('reportsPageBody');
  if (!box) return;
  const canSend = typeof canManage === 'function' && canManage();

  box.innerHTML = `
    <div class="section">
      <div class="section-title">Сводка по сети</div>
      <div class="empty" style="text-align:left;padding:0 16px 10px">
        Итог по сети (план/темп, лучшие и отстающие точки) — как ежедневные
        фото-отчёты по точке, только раз в неделю/месяц по всей сети.
      </div>
      ${canSend ? `
        <div style="padding:0 16px 16px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="mchip" onclick="sendNetworkDigestNow('weekly', this)">Отправить недельную</button>
          <button class="mchip" onclick="sendNetworkDigestNow('monthly', this)">Отправить месячную</button>
        </div>` : ''}
    </div>

    <div class="section">
      <div class="section-title">Отчёт по точке</div>
      <button class="row" onclick="switchPage('reportimg')">
        <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="18" height="18" x="3" y="3" rx="2" ry="2" /> <circle cx="9" cy="9" r="2" /> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /> </svg></div>
        <div class="row-body">
          <div class="row-title">Отчёт-картинка</div>
          <div class="row-sub">SVG итог дня по выбранной точке</div>
        </div>
        <div class="row-chevron">›</div>
      </button>
    </div>

    ${canSend ? `
    <div class="section">
      <div class="section-title">Экспорт CSV</div>
      <button class="row" onclick="exportCSV('sales')">
        <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 15V3" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <path d="m7 10 5 5 5-5" /> </svg></div>
        <div class="row-body"><div class="row-title">Продажи</div></div>
        <div class="row-chevron">›</div>
      </button>
      <button class="row" onclick="exportCSV('bfq')">
        <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 15V3" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <path d="m7 10 5 5 5-5" /> </svg></div>
        <div class="row-body"><div class="row-title">BFQ</div></div>
        <div class="row-chevron">›</div>
      </button>
      <button class="row" onclick="exportCSV('schedules')">
        <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 15V3" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <path d="m7 10 5 5 5-5" /> </svg></div>
        <div class="row-body"><div class="row-title">График</div></div>
        <div class="row-chevron">›</div>
      </button>
    </div>` : ''}
  `;
}

async function sendNetworkDigestNow(kind, btnEl) {
  if (btnEl?.disabled) return;
  if (btnEl) btnEl.disabled = true;
  try {
    const res = await fetch(API + '/reports/send-digest', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ kind })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'fail');
    toast(kind === 'monthly' ? 'Месячная сводка отправлена' : 'Недельная сводка отправлена', 'ok');
  } catch (e) {
    toast(e.message || 'Не удалось отправить сводку', 'err');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}
