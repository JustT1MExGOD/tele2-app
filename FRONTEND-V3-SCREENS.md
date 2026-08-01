# Frontend v3 — новые экраны

Добавь в `index.html` (v2) страницы и логику ниже.

## 1. Навигация

В bottom-nav для менеджера можно показать «Ещё».  
Либо внутри «Команда» / отдельная кнопка на главной.

Рекомендуемые страницы:
- `page-bfq` — уже есть, расширяем
- `page-schedule` — просмотр + **редактор** для manager
- `page-history` — история продаж
- `page-admin` — роли, экспорт, VMR

---

## 2. JS: роль пользователя

После `let me = null` храни:

```js
let me = null; // { employee_id, full_name, role, is_manager }
```

В silent load `/me` уже есть — сохрани `is_manager`.

```js
function canManage() {
  return me?.role === 'manager' || me?.role === 'admin' || me?.is_manager;
}
```

---

## 3. BFQ — полноценный список

```js
async function loadBFQ() {
  const box = document.getElementById('bfqList');
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const month = scheduleMonth || todayMoscow().slice(0, 7);
    const res = await fetch(API + '/bfq?month=' + month);
    const data = await res.json();
    const list = data.items || [];

    if (!list.length) {
      box.innerHTML = '<div class="empty">Нет данных</div>';
      return;
    }

    box.innerHTML = list.map((e, i) => `
      <button class="row" onclick="openBFQCard(${e.employee_id})">
        <div class="row-icon">${i + 1}</div>
        <div class="row-body">
          <div class="row-title">${e.full_name}</div>
          <div class="row-sub">
            Кач. ${e.quality} · Приб. ${e.profit}
            · VMR ${e.vmr}${e.penalty ? ' · штраф ' + e.penalty : ''}
          </div>
        </div>
        <div class="row-value">${e.total}</div>
        <div class="row-chevron">›</div>
      </button>
    `).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty">Ошибка BFQ</div>';
  }
}

async function openBFQCard(id) {
  document.getElementById('modalTitle').textContent = 'BFQ';
  document.getElementById('modalBody').innerHTML = '<div class="empty">Загрузка…</div>';
  document.getElementById('overlay').classList.add('show');

  const month = todayMoscow().slice(0, 7);
  const res = await fetch(API + '/bfq/' + id + '?month=' + month);
  const d = await res.json();
  const f = d.fact || {};
  const fc = d.forecast || {};

  let manualHtml = '';
  if (canManage()) {
    manualHtml = `
      <div class="field"><label>VMR средний</label>
        <input type="number" id="bfqVmr" value="${f.vmr || 0}" step="0.1"></div>
      <div class="field"><label>Штраф</label>
        <input type="number" id="bfqPenalty" value="${f.penalty || 0}" step="0.1"></div>
      <button class="btn-main" onclick="saveBFQManual(${id})">Сохранить VMR / штраф</button>
    `;
  }

  document.getElementById('modalTitle').textContent = 'BFQ';
  document.getElementById('modalBody').innerHTML = `
    <div class="stats-row">
      <div class="stat-chip"><div class="n">${f.total ?? '—'}</div><div class="l">Факт</div></div>
      <div class="stat-chip"><div class="n">${fc.total ?? '—'}</div><div class="l">Прогноз</div></div>
      <div class="stat-chip"><div class="n">${f.quality ?? '—'}</div><div class="l">Качество</div></div>
    </div>
    <div class="progress-block">
      ${progressHTML('GI', f.blocks?.gi, 50)}
      ${progressHTML('VMR', f.blocks?.vmr, 12)}
      ${progressHTML('Digital', f.blocks?.digital, 25)}
      ${progressHTML('Top-up', f.blocks?.topUp, 15)}
      ${progressHTML('Прибыль', f.profit, 20)}
    </div>
    <div class="row-sub" style="padding:8px 0">
      Смены: ${d.shifts?.worked || 0} отработано · ${d.shifts?.remaining || 0} осталось
    </div>
    ${manualHtml}
  `;
}

async function saveBFQManual(employeeId) {
  const vmr = Number(document.getElementById('bfqVmr').value) || 0;
  const penalty = Number(document.getElementById('bfqPenalty').value) || 0;
  const month = todayMoscow().slice(0, 7);
  const res = await fetch(API + '/bfq/manual', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Id': String(tgUser()?.id || '')
    },
    body: JSON.stringify({ employee_id: employeeId, month, vmr_avg: vmr, penalty })
  });
  if (!res.ok) { toast('Нет прав или ошибка', 'err'); return; }
  toast('Сохранено', 'ok');
  closeModal();
  loadBFQ();
}
```

**Важно:** во все `fetch` к защищённым ручкам добавляй заголовок:

```js
headers: { 'X-Telegram-Id': String(tgUser()?.id || '') }
```

---

## 4. Редактор графика (manager)

В `loadMonthSchedule` после сетки, если `canManage()`:

```js
// при тапе на ячейку дня
function editDay(employeeId, dateStr, currentStoreId, currentHours) {
  if (!canManage()) return;

  document.getElementById('modalTitle').textContent = 'Смена ' + dateStr;
  document.getElementById('modalBody').innerHTML = `
    <div class="field">
      <label>Точка</label>
      <select id="schStore">
        ${stores.map(s => `<option value="${s.id}" ${s.id===currentStoreId?'selected':''}>${s.name}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Часы (0 = выходной)</label>
      <input type="number" id="schHours" value="${currentHours || 0}" min="0" max="14">
    </div>
    <div class="field">
      <label>Смена текст</label>
      <input id="schText" value="10-21" placeholder="10-21">
    </div>
    <button class="btn-main" onclick="saveShift(${employeeId}, '${dateStr}')">Сохранить</button>
  `;
  document.getElementById('overlay').classList.add('show');
}

async function saveShift(employeeId, dateStr) {
  const store_id = document.getElementById('schStore').value;
  const hours = Number(document.getElementById('schHours').value) || 0;
  const shift_text = document.getElementById('schText').value || '';

  const res = await fetch(API + '/schedules/bulk', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Id': String(tgUser()?.id || '')
    },
    body: JSON.stringify({
      items: [{ employee_id: employeeId, work_date: dateStr, store_id, hours, shift_text }]
    })
  });
  if (!res.ok) { toast('Нет прав', 'err'); return; }
  toast('Смена сохранена', 'ok');
  closeModal();
  loadMonthSchedule();
}
```

В генерации ячеек добавь `onclick`:

```js
cells += `<div class="sch-cell work" onclick="editDay(${empId}, '${key}', '${row.store_id}', ${row.hours})">...`;
// для off:
cells += `<div class="sch-cell off" onclick="editDay(${empId}, '${key}', '${stores[0]?.id || ''}', 0)">...`;
```

Нужно прокинуть `empId` в map сотрудников.

---

## 5. История

```html
<div id="page-history" class="page">
  <div class="section">
    <div class="section-title">История продаж</div>
    <div id="historyList"><div class="skeleton"></div></div>
  </div>
</div>
```

```js
async function loadHistory() {
  const box = document.getElementById('historyList');
  const from = todayMoscow().slice(0, 8) + '01';
  const to = todayMoscow();
  const res = await fetch(
    `${API}/sales/history?from=${from}&to=${to}`,
    { headers: { 'X-Telegram-Id': String(tgUser()?.id || '') } }
  );
  const data = await res.json();
  const items = data.items || [];
  if (!items.length) {
    box.innerHTML = '<div class="empty">Пусто</div>';
    return;
  }
  box.innerHTML = items.map(s => `
    <div class="row">
      <div class="row-body">
        <div class="row-title">${s.full_name}</div>
        <div class="row-sub">${String(s.sale_date).slice(0,10)} · ${s.store_name}
          · SIM ${s.sim} · MNP ${s.mnp} · ПА ${s.pa}</div>
      </div>
    </div>
  `).join('');
}
```

---

## 6. Экспорт (manager)

На главной или в admin-секции:

```html
<button class="row" onclick="exportCSV('sales')">
  <div class="row-icon">⬇️</div>
  <div class="row-body"><div class="row-title">Экспорт продаж CSV</div></div>
  <div class="row-chevron">›</div>
</button>
<button class="row" onclick="exportCSV('bfq')">
  <div class="row-icon">⬇️</div>
  <div class="row-body"><div class="row-title">Экспорт BFQ CSV</div></div>
  <div class="row-chevron">›</div>
</button>
```

```js
function exportCSV(type) {
  if (!canManage()) { toast('Только управляющий', 'err'); return; }
  const month = todayMoscow().slice(0, 7);
  const from = month + '-01';
  const to = todayMoscow();
  const tgId = String(tgUser()?.id || '');
  let url = '';
  if (type === 'sales') url = `${API}/export/sales.csv?from=${from}&to=${to}`;
  if (type === 'bfq') url = `${API}/export/bfq.csv?month=${month}`;
  if (type === 'schedules') url = `${API}/export/schedules.csv?month=${month}`;

  // Telegram WebView: открыть снаружи
  if (tg?.openLink) tg.openLink(url + (url.includes('?') ? '&' : '?') + 'tg=' + tgId);
  else window.open(url, '_blank');
}
```

> Для CSV в WebView заголовок `X-Telegram-Id` не уйдёт через `openLink`.  
> Проще временно разрешить экспорт по query `?telegram_id=` **только для manager**  
> или отдавать CSV как blob через fetch + download.

Надёжный вариант:

```js
async function exportCSV(type) {
  if (!canManage()) { toast('Только управляющий', 'err'); return; }
  const month = todayMoscow().slice(0, 7);
  const from = month + '-01';
  const to = todayMoscow();
  let path = '';
  if (type === 'sales') path = `/export/sales.csv?from=${from}&to=${to}`;
  if (type === 'bfq') path = `/export/bfq.csv?month=${month}`;
  if (type === 'schedules') path = `/export/schedules.csv?month=${month}`;

  const res = await fetch(API + path, {
    headers: { 'X-Telegram-Id': String(tgUser()?.id || '') }
  });
  if (!res.ok) { toast('Ошибка экспорта', 'err'); return; }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = type + '.csv';
  a.click();
}
```

---

## 7. SQL: назначить управляющего

```sql
UPDATE employees SET role = 'manager' WHERE full_name ILIKE '%Каравашков%';
-- или по id:
UPDATE employees SET role = 'manager' WHERE id = 1;
```
