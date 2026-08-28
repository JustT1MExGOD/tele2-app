/**
 * 21.x (Frontend rewrite continuation, batch of 13) — replacing
 * frontend/js/04-schedule.js file-for-file: план дня по точкам, график на
 * сегодня, месячный календарь (личный + сводный на всю команду), правка дня.
 *
 * monthLabel() already had an ambient declaration in legacy-globals.d.ts
 * (attributed to this file, read by src/pages/plans-bfq) — this is its real
 * owner/implementation; declaration stays as-is, same precedent as
 * openModal/closeModal.
 */
import type {
  StatsDailyRow,
  ScheduleRow,
  PlansTemplateResponse,
  StoreDailyPlansResponse,
  ScheduleMonthResponse,
  EmployeeListItem
} from '../../../../src/shared/api-types.js';

// ===== PLAN DAY =====
export async function loadPlanDay(): Promise<void> {
  const box = document.getElementById('planList');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const date = todayMoscow();
    // 1) факт + график + шаблон/день из /plans?date=
    // 2) параллельно computed из /plans/stores/daily (из месячных планов сотрудников)
    const ov = orgQueryParam();
    const [storesData, stats, schedules, plans, dailyComputed]: [any[], StatsDailyRow[], ScheduleRow[], PlansTemplateResponse, StoreDailyPlansResponse | null] = await Promise.all([
      fetchOrgStores(),
      window.apiClient.getStatsDaily(authHeaders(), date, ov),
      window.apiClient.getSchedules(authHeaders(), date, ov),
      window.apiClient.getPlansTemplate(authHeaders(), date),
      window.apiClient.getStoreDailyPlans(authHeaders(), ov, date).catch(() => null)
    ]);
    stores = storesData;

    const statsMap: Record<string, any> = {};
    (Array.isArray(stats) ? stats : []).forEach((s: any) => {
      statsMap[s.store_id || s.id] = s;
    });

    // Приоритет планов:
    // A) материализованные на сегодня (plan_date = date)
    // B) computed из месячного плана точки (/plans/stores/daily) — план точки
    //    теперь вносится вручную, независимо от планов сотрудников (раньше
    //    был ещё C — шаблон plan_date IS NULL, убрали вместе с долевым
    //    распределением, план точки его полностью заменяет)
    const planMap: Record<string, any> = {};
    const todayStr = date;

    (Array.isArray(plans) ? plans : []).forEach((p: any) => {
      const pd = p.plan_date ? String(p.plan_date).slice(0, 10) : null;
      if (pd === todayStr) {
        planMap[p.store_id] = { ...p, _src: 'day' };
      }
    });

    if (dailyComputed?.stores?.length) {
      dailyComputed.stores.forEach((st) => {
        const hasDay = planMap[st.store_id]?._src === 'day';
        if (!hasDay && st.plan) {
          planMap[st.store_id] = { store_id: st.store_id, ...st.plan, _src: 'computed' };
        }
      });
    }
    const staffMap: Record<string, ScheduleRow[]> = {};
    (Array.isArray(schedules) ? schedules : []).forEach((s) => {
      if (!staffMap[s.store_id]) staffMap[s.store_id] = [];
      staffMap[s.store_id].push(s);
    });

    const list = stores.slice().sort((a: any, b: any) => (a.hours || 0) - (b.hours || 0));
    if (!list.length) {
      box.innerHTML = '<div class="empty">Нет точек</div>';
      return;
    }

    box.innerHTML = list
      .map((store: any) => {
        const fact = statsMap[store.id] || {};
        const plan = planMap[store.id] || {};
        const staff = staffMap[store.id] || [];
        const keys = METRICS.slice(0, 8).map((m) => m.id);
        let sf = 0,
          sp = 0;
        keys.forEach((k) => {
          sf += +fact[k] || 0;
          sp += +plan[k] || 0;
        });
        const overall = sp > 0 ? Math.round((sf / sp) * 100) : sf > 0 ? 100 : 0;

        return `
            <div class="store-card" id="sc-${store.id}">
              <div class="store-head" onclick="toggleStore('${store.id}')">
                <div class="store-badge">${esc((store.short_name || store.name || '?').slice(0, 2))}</div>
                <div class="store-meta">
                  <div class="store-name">${esc(store.name)}</div>
                  <div class="store-code">${store.code || ''} · ${store.work_time || ''}</div>
                </div>
                <div class="store-pct ${pctTone(overall)}">${overall}%</div>
              </div>
              <div class="store-body">
                ${
                  staff.length
                    ? `<div class="chips">${staff.map((s) => `<span class="chip">${esc(s.full_name)}${s.shift_text ? ' · ' + esc(s.shift_text) : ''}</span>`).join('')}</div>`
                    : '<div class="empty" style="padding:12px 0">Нет на смене</div>'
                }

                <div class="block-label">Блок GI</div>
                ${progressHTML(metricLabel('sim'), fact.sim, plan.sim)}
                ${progressHTML(metricLabel('mnp'), fact.mnp, plan.mnp)}
                ${progressHTML(metricLabel('pa'), fact.pa, plan.pa)}
                ${progressHTML(metricLabel('hb'), fact.hb, plan.hb)}

                <div class="block-label">Товарка</div>
                ${progressHTML(metricLabel('combo'), fact.combo, plan.combo)}
                ${progressHTML(metricLabel('phones'), fact.phones, plan.phones)}
                ${progressHTML(metricLabel('accessories'), fact.accessories, plan.accessories)}
                ${progressHTML(metricLabel('insurance'), fact.insurance, plan.insurance)}

                <div class="block-label">Ростелеком</div>
                ${progressHTML(metricLabel('wink'), fact.wink, plan.wink)}
                ${progressHTML(metricLabel('shpd'), fact.shpd, plan.shpd)}
                ${progressHTML(metricLabel('focus'), fact.focus, plan.focus)}

                <div class="block-label">Кредиты</div>
                ${progressHTML('Заявка', fact.credit_request, plan.credit_request)}
                ${progressHTML('Выданный', fact.credit_issued, plan.credit_issued)}
              </div>
            </div>`;
      })
      .join('');
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Ошибка загрузки</div>';
  }
}

export function toggleStore(id: string): void {
  document.getElementById('sc-' + id)?.classList.toggle('open');
}

// ===== TODAY SCHEDULE =====
export async function loadTodaySchedule(): Promise<void> {
  const box = document.getElementById('todayList');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const date = todayMoscow();
    const orgParam = me?.role === 'admin' && adminViewOrgId ? '&org_id=' + encodeURIComponent(adminViewOrgId) : '';
    const [schedules, storesData]: [ScheduleRow[], any[]] = await Promise.all([window.apiClient.getSchedules(authHeaders(), date, orgParam), fetchOrgStores()]);
    stores = storesData;

    if (!Array.isArray(schedules) || !schedules.length) {
      box.innerHTML = '<div class="section"><div class="empty">Сегодня никого в графике</div></div>';
      return;
    }

    const byStore: Record<string, ScheduleRow[]> = {};
    schedules.forEach((s) => {
      if (!byStore[s.store_id]) byStore[s.store_id] = [];
      byStore[s.store_id].push(s);
    });

    box.innerHTML =
      (Array.isArray(stores) ? stores : [])
        .map((store: any) => {
          const list = byStore[store.id] || [];
          if (!list.length) return '';
          return `
            <div class="section today-store">
              <div class="section-title">${esc(store.name)}
                <div class="section-sub">${esc(store.code || '')}</div>
              </div>
              ${list
                .map(
                  (s) => `
                <button class="row" onclick="openEmployeeCard(${s.employee_id})">
                  <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /> <circle cx="12" cy="7" r="4" /> </svg></div>
                  <div class="row-body">
                    <div class="row-title">${esc(s.full_name)}</div>
                    <div class="row-sub">${esc(s.shift_text || '')} · ${s.hours || ''}ч</div>
                  </div>
                  <div class="row-chevron">›</div>
                </button>
              `
                )
                .join('')}
            </div>`;
        })
        .join('') || '<div class="section"><div class="empty">Пусто</div></div>';
  } catch (e) {
    box.innerHTML = '<div class="empty">Ошибка</div>';
  }
}

// ===== MONTH SCHEDULE =====
export function shiftMonth(delta: number): void {
  const [y, m] = scheduleMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  scheduleMonth = d.toISOString().slice(0, 7);
  loadMonthSchedule();
}

export function monthLabel(ym: string): string {
  const names = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const [y, m] = ym.split('-');
  return names[+m - 1] + ' ' + y;
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

const RU_WEEKDAYS_MON = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function weekdayHeaderHtml(): string {
  return `<div class="sch-week-head">${RU_WEEKDAYS_MON.map((w) => `<div>${w}</div>`).join('')}</div>`;
}

interface EmpMonth {
  id: number;
  name: string;
  days: Record<string, ScheduleRow>;
}

/** Настоящая календарная сетка (как в обычном календаре телефона) — раньше
 * дни шли просто по порядку 1..total без выравнивания по дням недели,
 * поэтому непонятно было, что попадает на выходные. День 1 теперь стоит в
 * своей настоящей колонке (Пн первая), а хвосты соседних месяцев — серые,
 * некликабельные, только для ориентира. */
function calendarCellsHtml(emp: EmpMonth, y: number, m: number, total: number, editable: boolean): string {
  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 0=Пн..6=Вс
  const prevTotal = new Date(y, m - 1, 0).getDate();

  let cells = '';
  for (let i = firstDow - 1; i >= 0; i--) {
    cells += `<div class="sch-cell pad"><div class="d">${prevTotal - i}</div></div>`;
  }
  for (let d = 1; d <= total; d++) {
    const key = scheduleMonth + '-' + String(d).padStart(2, '0');
    const row = emp.days[key];
    const storeId = row?.store_id || (stores[0] && stores[0].id) || '';
    const hours = row?.hours || 0;
    const click = editable ? `onclick="editDay(${emp.id}, '${key}', '${storeId}', ${hours})"` : '';
    if (row) {
      const short = (row.store_short || row.store_name || '').slice(0, 4);
      const col = storeColor(row.store_id);
      cells += `<div class="sch-cell work" ${click} title="${row.store_name || ''} ${row.shift_text || ''}"
            style="background:${col}22;color:${col};border-color:${col}">
            <div class="d">${d}</div><div class="s">${short}</div></div>`;
    } else {
      cells += `<div class="sch-cell off" ${click}><div class="d">${d}</div></div>`;
    }
  }
  const trailing = (7 - ((firstDow + total) % 7)) % 7;
  for (let d = 1; d <= trailing; d++) {
    cells += `<div class="sch-cell pad"><div class="d">${d}</div></div>`;
  }
  return cells;
}

export async function loadMonthSchedule(): Promise<void> {
  const labelEl = document.getElementById('monthLabel');
  if (labelEl) labelEl.textContent = monthLabel(scheduleMonth);
  const box = document.getElementById('monthBoard');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const orgParam = me?.role === 'admin' && adminViewOrgId ? '&org_id=' + encodeURIComponent(adminViewOrgId) : '';
    const data: ScheduleMonthResponse = await window.apiClient.getScheduleMonth(authHeaders(), scheduleMonth, orgParam).catch(() => ({ month: '', start: '', end: '', items: [] }));
    const items = data.items || [];

    if (!stores.length) {
      stores = await fetchOrgStores();
    }

    // Всегда полный список сотрудников, смены накладываем поверх — та же
    // сеть, что и месячный график выше, иначе строки грида у admin при
    // просмотре чужой сети — его СОБСТВЕННАЯ команда.
    const empParam = me?.role === 'admin' && adminViewOrgId ? '?org_id=' + encodeURIComponent(adminViewOrgId) : '';
    const emps: EmployeeListItem[] = await window.apiClient.getEmployees(authHeaders(), empParam);
    const byEmp: Record<string, EmpMonth> = {};
    (emps || []).forEach((e) => {
      byEmp[e.id] = { id: e.id, name: e.full_name, days: {} };
    });
    items.forEach((row) => {
      const id = row.employee_id;
      if (!byEmp[id]) byEmp[id] = { id, name: row.full_name, days: {} };
      const key = String(row.work_date).slice(0, 10);
      byEmp[id].days[key] = row;
    });

    const total = daysInMonth(scheduleMonth);
    const list = Object.values(byEmp).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const editable = canManage();

    renderSummarySchedule(list, total);
    const hint = editable ? '<div class="empty" style="padding:8px 0 12px">Нажми на день, чтобы поставить / убрать смену</div>' : '';

    const [gy, gm] = scheduleMonth.split('-').map(Number);
    box.innerHTML =
      hint +
      weekdayHeaderHtml() +
      (list
        .map((emp) => {
          const workCount = Object.keys(emp.days).length;
          const cells = calendarCellsHtml(emp, gy, gm, total, editable);
          return `
            <div class="sch-emp">
              <div class="sch-emp-head">
                <span>${emp.name}</span>
                <span class="cnt">${workCount} смен</span>
              </div>
              <div class="sch-grid">${cells}</div>
            </div>`;
        })
        .join('') || '<div class="empty">Нет данных</div>');
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Ошибка загрузки графика</div>';
  }
}

/** manager/senior/admin — сводный график всей команды на месяц (как
 * Excel-версия, которой сеть уже пользуется), а не только свой личный график
 * ниже. Обычный сотрудник этот блок не видит. */
function canViewSummarySchedule(): boolean {
  const r = (typeof me !== 'undefined' && me && me.role) || '';
  return r === 'manager' || r === 'senior' || r === 'admin';
}

const RU_WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function renderSummarySchedule(list: EmpMonth[], total: number): void {
  const section = document.getElementById('summaryScheduleSection');
  if (!section) return;
  if (!canViewSummarySchedule()) {
    section.innerHTML = '';
    return;
  }
  if (!list.length) {
    section.innerHTML = '';
    return;
  }

  const [y, m] = scheduleMonth.split('-').map(Number);
  let head = '<th class="sum-sch-name">ФИО</th>';
  for (let d = 1; d <= total; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    head += `<th class="sum-sch-day${dow === 0 || dow === 6 ? ' we' : ''}">${d}<br><span>${RU_WEEKDAYS[dow]}</span></th>`;
  }

  const rows = list
    .map((emp) => {
      let modeCells = '',
        hourCells = '';
      for (let d = 1; d <= total; d++) {
        const key = scheduleMonth + '-' + String(d).padStart(2, '0');
        const row = emp.days[key];
        const hours = Number(row?.hours) || 0;
        const isOff = !row || hours <= 0;
        if (isOff) {
          modeCells += `<td class="sum-sch-cell off">вых</td>`;
          hourCells += `<td class="sum-sch-cell off">0</td>`;
        } else {
          // Сводка теперь на всю сеть сразу (несколько точек в одной таблице,
          // не одна точка на лист, как в Excel-версии) — без названия точки
          // в самой ячейке непонятно, куда именно вышел человек в этот день,
          // особенно при подменах на чужой точке. Цвет ячейки — цвет точки,
          // тот же язык, что уже у .sch-cell.work в календарной сетке ниже
          // на этой же странице (было: статичный "warning"-жёлтый для всех
          // точек сразу, несостыковка визуала).
          const col = storeColor(row.store_id);
          const cellStyle = `style="background:${col}22;color:${col};border-color:${col}"`;
          const storeShort = esc((row.store_short || row.store_name || '').slice(0, 6));
          modeCells += `<td class="sum-sch-cell work" ${cellStyle} title="${esc(row.store_name || '')}">
              ${esc(row.shift_text || '')}<br><span class="sum-sch-store" style="color:inherit">${storeShort}</span></td>`;
          hourCells += `<td class="sum-sch-cell work" ${cellStyle}>${hours}</td>`;
        }
      }
      return `
          <tr>
            <td class="sum-sch-name" rowspan="2">${esc(emp.name)}</td>
            ${modeCells}
          </tr>
          <tr>${hourCells}</tr>`;
    })
    .join('');

  section.innerHTML = `
        <div class="section-title" style="padding:0 0 8px">Сводный график команды</div>
        <div class="sum-sch-scroll">
          <table class="sum-sch-table">
            <thead><tr>${head}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
}

export async function editDay(employeeId: number, dateStr: string, currentStoreId: string, currentHours: number): Promise<void> {
  if (!canManage()) return;
  if (!stores.length) {
    stores = await fetchOrgStores();
  }
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Смена ' + dateStr;
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
        <div class="field">
          <label>Точка</label>
          <select id="schStore">
            ${(stores || []).map((s) => `<option value="${s.id}" ${s.id === currentStoreId ? 'selected' : ''}>${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Часы (0 = выходной)</label>
          <input type="number" id="schHours" value="${currentHours || 0}" min="0" max="14">
        </div>
        <div class="field">
          <label>Смена</label>
          <input id="schText" value="${currentHours ? '10-21' : '10-21'}" placeholder="10-21">
        </div>
        <button class="btn-main" onclick="saveShift(${employeeId}, '${dateStr}')">Сохранить</button>
      `;
  }
  document.getElementById('overlay')?.classList.add('show');
}

export async function saveShift(employeeId: number, dateStr: string): Promise<void> {
  const store_id = (document.getElementById('schStore') as HTMLSelectElement | null)?.value || '';
  const hours = Number((document.getElementById('schHours') as HTMLInputElement | null)?.value) || 0;
  const shift_text = (document.getElementById('schText') as HTMLInputElement | null)?.value || '';
  try {
    await window.apiClient.saveSchedulesBulk(authHeaders(true), {
      items: [{ employee_id: employeeId, work_date: dateStr, store_id, hours, shift_text }]
    });
    toast('Смена сохранена', 'ok');
    closeModal();
    loadMonthSchedule();
  } catch (e: any) {
    toast(e?.message || 'Нет прав', 'err');
  }
}

declare global {
  interface Window {
    loadPlanDay: typeof loadPlanDay;
    toggleStore: typeof toggleStore;
    loadTodaySchedule: typeof loadTodaySchedule;
    shiftMonth: typeof shiftMonth;
    monthLabel: typeof monthLabel;
    loadMonthSchedule: typeof loadMonthSchedule;
    editDay: typeof editDay;
    saveShift: typeof saveShift;
  }
}
window.loadPlanDay = loadPlanDay;
window.toggleStore = toggleStore;
window.loadTodaySchedule = loadTodaySchedule;
window.shiftMonth = shiftMonth;
window.monthLabel = monthLabel;
window.loadMonthSchedule = loadMonthSchedule;
window.editDay = editDay;
window.saveShift = saveShift;
