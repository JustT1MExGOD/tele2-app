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
  EmployeeListItem,
  ScheduleDraftStatus,
  ScheduleDraftItemRow,
  StaffingRequirementRow,
  SchedulePreferenceRow
} from '../../../../src/shared/api-types.js';
import { REPLACEMENT_PLACEHOLDER_STORE_ID } from '../../../../src/shared/replacement.js';

const scheduleEntries = new Map<string, ScheduleRow>();

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
function storeNameById(storeId: string): string {
  const s = (stores || []).find((st: any) => st.id === storeId);
  return s ? s.name : storeId;
}

/** draftByDate — черновик автоматического графика (см. раздел «Автоматический
 * генератор графика» ниже), наложенный поверх сетки на дни без сохранённой
 * смены: визуально отличается (пунктирная граница, светлее заливка), никогда
 * не подменяет и не затеняет уже сохранённую смену (row всегда в приоритете). */
function calendarCellsHtml(
  emp: EmpMonth, y: number, m: number, total: number, editable: boolean,
  draftByDate?: Record<string, ScheduleDraftItemRow>
): string {
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
      // esc() — store_short/store_name с бэкенда не валидируются на формат
      // (произвольная строка), уже правильно экранируются в соседнем
      // renderSummarySchedule() ниже; тут раньше экранирования не было
      // (hotfix 20.57.1, finding #5).
      const isReplacementPlaceholder = row.store_id === REPLACEMENT_PLACEHOLDER_STORE_ID;
      const short = isReplacementPlaceholder ? 'Зам' : esc((row.store_short || row.store_name || '').slice(0, 4));
      const col = isReplacementPlaceholder ? '#00c853' : storeColor(row.store_id);
      const title = isReplacementPlaceholder ? `Замена (точка неизвестна) ${row.shift_text || ''}` : `${row.store_name || ''} ${row.shift_text || ''}`;
      cells += `<div class="sch-cell work" ${click} title="${esc(title)}"
            style="background:${col}22;color:${col};border-color:${col}">
            <div class="d">${d}</div><div class="s">${short}</div></div>`;
    } else {
      const draftItem = draftByDate ? draftByDate[key] : undefined;
      if (draftItem) {
        const storeName = storeNameById(draftItem.store_id);
        const short = esc((storeName || '').slice(0, 4));
        const col = storeColor(draftItem.store_id);
        cells += `<div class="sch-cell draft" ${click} title="${esc(`Черновик: ${storeName} ${draftItem.shift_text}`)}"
              style="background:${col}11;color:${col};border:1px dashed ${col}">
              <div class="d">${d}</div><div class="s">${short}</div></div>`;
      } else {
        cells += `<div class="sch-cell off" ${click}><div class="d">${d}</div></div>`;
      }
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

  // Hotfix 20.57.1 PASS 3, finding #1 — раньше getScheduleMonth() имел
  // .catch(() => ({items: []})): любая транспортная/API-ошибка (5xx, сеть,
  // истёкшая сессия) молча превращалась в валидный "пустой месяц" и
  // рендерилась как "Нет данных" — неотличимо от настоящего пустого
  // графика, и НЕ то, что показывал production-скриншот ("Ошибка загрузки
  // графика" — этот текст мог прийти только из getEmployees()/рендеринга
  // ниже, единственных мест без такого маскирующего catch). Каждый шаг
  // теперь падает явно, с отдельным sanitized-тегом стадии в консоли (без
  // PII — логируется только Error, не тела ответа/данные сотрудников) —
  // так следующий подобный инцидент можно будет диагностировать по логам,
  // а не гадать по скриншоту.
  const orgParam = me?.role === 'admin' && adminViewOrgId ? '&org_id=' + encodeURIComponent(adminViewOrgId) : '';
  let data: ScheduleMonthResponse;
  try {
    data = await window.apiClient.getScheduleMonth(authHeaders(), scheduleMonth, orgParam);
  } catch (e) {
    console.error('[schedule] SCHEDULE_MONTH_FETCH_FAILED', e);
    box.innerHTML = '<div class="empty">Ошибка загрузки графика — не удалось получить смены</div>';
    return;
  }
  const items = data.items || [];
  scheduleEntries.clear();
  for (const row of items) scheduleEntries.set(`${row.employee_id}:${String(row.work_date).slice(0,10)}`, row);

  try {
    if (!stores.length) {
      stores = await fetchOrgStores();
    }
  } catch (e) {
    console.error('[schedule] SCHEDULE_STORES_FETCH_FAILED', e);
    box.innerHTML = '<div class="empty">Ошибка загрузки графика — не удалось получить точки</div>';
    return;
  }

  // Всегда полный список сотрудников, смены накладываем поверх — та же
  // сеть, что и месячный график выше, иначе строки грида у admin при
  // просмотре чужой сети — его СОБСТВЕННАЯ команда.
  const empParam = me?.role === 'admin' && adminViewOrgId ? '?org_id=' + encodeURIComponent(adminViewOrgId) : '';
  let emps: EmployeeListItem[];
  try {
    emps = await window.apiClient.getEmployees(authHeaders(), empParam);
  } catch (e) {
    console.error('[schedule] SCHEDULE_EMPLOYEES_FETCH_FAILED', e);
    box.innerHTML = '<div class="empty">Ошибка загрузки графика — не удалось получить сотрудников</div>';
    return;
  }

  try {
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

    const draftByEmp = scheduleDraftItemsByEmployeeDate();
    const [gy, gm] = scheduleMonth.split('-').map(Number);
    box.innerHTML =
      hint +
      weekdayHeaderHtml() +
      (list
        .map((emp) => {
          const workCount = Object.keys(emp.days).length;
          const cells = calendarCellsHtml(emp, gy, gm, total, editable, draftByEmp.get(emp.id));
          // esc(emp.name) — full_name не валидируется на формат на бэкенде;
          // раньше тут вставлялось без экранирования (hotfix 20.57.1,
          // finding #5).
          return `
            <div class="sch-emp">
              <div class="sch-emp-head">
                <span>${esc(emp.name)}</span>
                <span class="cnt">${workCount} смен</span>
              </div>
              <div class="sch-grid">${cells}</div>
            </div>`;
        })
        .join('') || '<div class="empty">Нет данных</div>');
  } catch (e) {
    console.error('[schedule] SCHEDULE_RENDER_FAILED', e);
    box.innerHTML = '<div class="empty">Ошибка отображения графика</div>';
  }

  await initScheduleDraftSection();
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
          const isReplacementPlaceholder = row.store_id === REPLACEMENT_PLACEHOLDER_STORE_ID;
          const col = isReplacementPlaceholder ? '#00c853' : storeColor(row.store_id);
          const cellStyle = `style="background:${col}22;color:${col};border-color:${col}"`;
          const storeShort = isReplacementPlaceholder ? 'Замена' : esc((row.store_short || row.store_name || '').slice(0, 6));
          modeCells += `<td class="sum-sch-cell work" ${cellStyle} title="${esc(isReplacementPlaceholder ? 'Замена (точка неизвестна)' : (row.store_name || ''))}">
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
  const current = scheduleEntries.get(`${employeeId}:${dateStr}`);
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
            <option value="${REPLACEMENT_PLACEHOLDER_STORE_ID}" style="background:#00c853;color:#fff;font-weight:700" ${currentStoreId === REPLACEMENT_PLACEHOLDER_STORE_ID ? 'selected' : ''}>Замена (точка неизвестна)</option>
            ${(stores || []).map((s) => `<option value="${esc(s.id)}" ${s.id === currentStoreId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Часы (0 = выходной)</label>
          <input type="number" id="schHours" value="${currentHours || 0}" min="0" max="14">
        </div>
        <div class="field">
          <label>Смена</label>
          <input id="schText" value="${esc(current?.shift_text || '10-21')}" placeholder="10-21">
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
    const saved = await window.apiClient.saveSchedulesBulk(authHeaders(true), {
      items: [{ employee_id: employeeId, work_date: dateStr, store_id, hours, shift_text }]
    });
    if (saved.count !== 1) throw new Error('Смена не сохранена: обновите график и повторите');
    toast('Смена сохранена', 'ok');
    closeModal();
    loadMonthSchedule();
  } catch (e: any) {
    toast(e?.message || 'Нет прав', 'err');
  }
}

// ===== Автоматический генератор месячного графика (DRAFT -> APPLY,
// /schedule-drafts) — см. план synthetic-roaming-mountain. Черновик живёт
// только в памяти этой сессии (бэкенд не предоставляет "последний
// черновик" эндпоинт, в отличие от employee-plan-drafts) — при переходе на
// другой месяц/перезагрузке страницы нужно рассчитать заново. =====
type ScheduleDraftState = {
  id: number;
  month: string;
  status: ScheduleDraftStatus;
  blocking_errors: { message: string }[];
};
let scheduleDraft: ScheduleDraftState | null = null;
let scheduleDraftItems: ScheduleDraftItemRow[] = [];

function scheduleDraftMonthOptions(): { value: string; label: string }[] {
  const [y, m] = todayMoscow().slice(0, 7).split('-').map(Number);
  const current = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return [
    { value: current, label: monthLabel(current.slice(0, 7)) },
    { value: next, label: monthLabel(next.slice(0, 7)) }
  ];
}

/** Заполняет select месяца черновика (идемпотентно), по умолчанию — текущий месяц. */
function ensureScheduleDraftMonthSelectPopulated(): void {
  const select = document.getElementById('scheduleDraftMonthSelect') as HTMLSelectElement | null;
  if (!select || select.options.length) return;
  const options = scheduleDraftMonthOptions();
  select.innerHTML = options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  select.value = options[0].value;
}

function scheduleDraftStatusLabel(status: ScheduleDraftStatus): string {
  if (status === 'applied') return 'Применён';
  if (status === 'stale') return 'Устарел';
  return 'Черновик';
}

function scheduleDraftTierLabel(tier: string): string {
  const labels: Record<string, string> = {
    employee_store_weekday: 'по истории сотрудника на этой точке в этот день недели',
    employee_store: 'по истории сотрудника на этой точке',
    employee: 'по общей истории сотрудника',
    store_weekday: 'по среднему точки в этот день недели',
    store: 'по среднему показателю точки',
    org: 'по среднему показателю сети',
    no_history: 'истории нет — только покрытие/доступность'
  };
  return labels[tier] || tier;
}

/** employee_id из БД может прийти строкой (bigint-драйвер) — всегда Number() перед использованием как ключ. */
function scheduleDraftItemsByEmployeeDate(): Map<number, Record<string, ScheduleDraftItemRow>> {
  const byEmp = new Map<number, Record<string, ScheduleDraftItemRow>>();
  for (const it of scheduleDraftItems) {
    const empId = Number(it.employee_id);
    if (!byEmp.has(empId)) byEmp.set(empId, {});
    byEmp.get(empId)![String(it.work_date).slice(0, 10)] = it;
  }
  return byEmp;
}

async function renderScheduleDraftSummary(): Promise<void> {
  const errBox = document.getElementById('scheduleDraftErrors');
  const summaryBox = document.getElementById('scheduleDraftSummary');
  const applyBtn = document.getElementById('scheduleDraftApplyBtn') as HTMLButtonElement | null;
  if (!errBox || !summaryBox) return;

  if (!scheduleDraft) {
    errBox.innerHTML = '';
    summaryBox.innerHTML = '<div class="empty" style="padding:0 16px 12px">Черновик графика ещё не рассчитан.</div>';
    if (applyBtn) applyBtn.style.display = 'none';
    return;
  }

  const blocking = scheduleDraft.blocking_errors || [];
  if (blocking.length) {
    errBox.innerHTML =
      '<div class="empty" style="text-align:left;padding:0 16px 12px;color:#e5484d"><b>Есть блокирующие ошибки — применить график нельзя, пока они не устранены:</b><ul style="margin:6px 0 0 18px;padding:0">' +
      blocking.map((be) => `<li>${esc(be.message)}</li>`).join('') +
      '</ul></div>';
  } else if (scheduleDraft.status === 'stale') {
    errBox.innerHTML =
      '<div class="empty" style="text-align:left;padding:0 16px 12px;color:#e5484d">Черновик устарел: график или настройки покрытия/доступности изменились после расчёта. Пересчитайте график заново.</div>';
  } else {
    errBox.innerHTML = '';
  }

  const monthTxt = monthLabel(scheduleDraft.month.slice(0, 7));
  const byEmp = scheduleDraftItemsByEmployeeDate();
  let html = `<div class="empty" style="text-align:left;padding:0 16px 8px">Месяц: <b>${esc(monthTxt)}</b> · Статус: <b>${esc(scheduleDraftStatusLabel(scheduleDraft.status))}</b> · смен: <b>${scheduleDraftItems.length}</b></div>`;

  if (!byEmp.size) {
    html += '<div class="empty" style="padding:0 16px 12px">Нет назначенных смен в черновике.</div>';
  } else {
    const names: Record<number, string> = {};
    (employees || []).forEach((e: any) => {
      names[e.id] = e.full_name;
    });
    const rows = Array.from(byEmp.entries()).sort((a, b) => (names[a[0]] || '').localeCompare(names[b[0]] || '', 'ru'));
    html +=
      '<div class="mobile-table">' +
      rows
        .map(([empId, byDate]) => {
          const items = Object.values(byDate);
          const byStore: Record<string, number> = {};
          let hours = 0;
          items.forEach((it) => {
            byStore[it.store_id] = (byStore[it.store_id] || 0) + 1;
            hours += Number(it.hours) || 0;
          });
          const storeBreakdown = Object.entries(byStore)
            .map(([storeId, count]) => `${esc(storeNameById(storeId))}: ${count} смен`)
            .join('; ');
          const tiers = new Set(items.map((it) => (it.explanation as any)?.tier).filter(Boolean));
          const tierTxt = Array.from(tiers)
            .map((t) => scheduleDraftTierLabel(String(t)))
            .join('; ');
          return `<div class="mt-card">
            <div class="mt-card-head">
              <div>
                <div class="mt-name">${esc(names[empId] || `#${empId}`)}</div>
                <div class="mt-meta">смен: ${items.length} · часов: ${hours}</div>
              </div>
            </div>
            <div class="empty" style="text-align:left;padding:6px 0 0">${esc(storeBreakdown)}</div>
            <div class="empty" style="text-align:left;padding:0 0 6px;color:#888">${esc(tierTxt)}</div>
          </div>`;
        })
        .join('') +
      '</div>';
  }

  summaryBox.innerHTML = html;
  if (applyBtn) applyBtn.style.display = scheduleDraft.status === 'draft' && !blocking.length ? '' : 'none';
}

async function initScheduleDraftSection(): Promise<void> {
  const section = document.getElementById('scheduleDraftSection');
  if (!section) return;
  if (!canManage()) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  ensureScheduleDraftMonthSelectPopulated();
  await renderScheduleDraftSummary();
}

export async function generateScheduleDraft(): Promise<void> {
  if (!canManage()) return;
  ensureScheduleDraftMonthSelectPopulated();
  const monthSelect = document.getElementById('scheduleDraftMonthSelect') as HTMLSelectElement | null;
  const btn = document.getElementById('scheduleDraftGenerateBtn') as HTMLButtonElement | null;
  if (btn) {
    btn.setAttribute('disabled', 'disabled');
    btn.textContent = 'Считаем…';
  }
  try {
    const body: { org_id?: string; month?: string } = {};
    if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
    if (monthSelect?.value) body.month = monthSelect.value;
    const gen = await window.apiClient.generateScheduleDraft(authHeaders(true), body);
    // GET /:id, не сырые items из generate — их формы различаются
    // (empId/date/storeId у generate vs employee_id/work_date/store_id из
    // БД), см. план/бэкенд-тесты для полного обоснования этого различия.
    const view = await window.apiClient.getScheduleDraftById(authHeaders(), gen.draft_id, orgQueryParam());
    scheduleDraft = view.draft
      ? { id: view.draft.id, month: view.draft.month, status: view.draft.status, blocking_errors: view.draft.blocking_errors || [] }
      : { id: gen.draft_id, month: gen.month, status: gen.status, blocking_errors: gen.blocking_errors || [] };
    scheduleDraftItems = view.items || [];
    toast(`Черновик графика на ${monthLabel(gen.month.slice(0, 7))} рассчитан`, 'ok');
  } catch (e: any) {
    toast(e?.message || 'Не удалось рассчитать черновик графика', 'err');
  } finally {
    if (btn) {
      btn.removeAttribute('disabled');
      btn.textContent = 'Составить график автоматически';
    }
  }
  await loadMonthSchedule();
}

export async function applyScheduleDraftAction(): Promise<void> {
  if (!canManage() || !scheduleDraft) return;
  const monthTxt = monthLabel(scheduleDraft.month.slice(0, 7));
  if (!confirm(`Применить рассчитанный график на ${monthTxt}? Смены на редактируемые даты этого месяца будут заменены.`)) return;

  const btn = document.getElementById('scheduleDraftApplyBtn') as HTMLButtonElement | null;
  if (btn) btn.setAttribute('disabled', 'disabled');
  try {
    const body: { org_id?: string; replace?: boolean } = {};
    if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
    let res = await window.apiClient.applyScheduleDraft(authHeaders(true), scheduleDraft.id, body);

    // Отдельное, второе подтверждение — если на месяц уже есть смены,
    // отличное от главного "применить?" выше (п. спецификации).
    if (!res.applied && res.requires_replace_confirmation) {
      const n = res.existing_editable_shifts || 0;
      if (!confirm(`На этот месяц уже есть ${n} смен(ы) на редактируемые даты — заменить их?`)) return;
      res = await window.apiClient.applyScheduleDraft(authHeaders(true), scheduleDraft.id, { ...body, replace: true });
    }

    scheduleDraft = { id: res.draft.id, month: res.draft.month, status: res.draft.status, blocking_errors: res.draft.blocking_errors || [] };
    if (res.applied) {
      toast('График сохранён', 'ok');
      await loadMonthSchedule();
      if (confirm('График сохранён. Рассчитать персональные планы на этот месяц?')) {
        const planMonthSelect = document.getElementById('planDraftMonthSelect') as HTMLSelectElement | null;
        if (planMonthSelect) planMonthSelect.value = scheduleDraft.month.slice(0, 10);
        if (typeof window.generateEmployeePlanDrafts === 'function') window.generateEmployeePlanDrafts();
      }
    } else {
      await renderScheduleDraftSummary();
    }
  } catch (e: any) {
    if (e?.code === 'stale_draft') {
      toast('Черновик устарел: график изменился — пересчитайте', 'err');
      scheduleDraft = { ...scheduleDraft, status: 'stale' };
      await renderScheduleDraftSummary();
    } else if (e?.code === 'blocking_errors') {
      toast('В черновике есть блокирующие ошибки — сначала устраните их', 'err');
    } else {
      toast(e?.message || 'Не удалось применить график', 'err');
    }
  } finally {
    if (btn) btn.removeAttribute('disabled');
  }
}

// ===== Настройка покрытия точки (store_staffing_requirements) — минимальный редактор =====
const RU_WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export async function openStaffingEditor(): Promise<void> {
  if (!canManage()) return;
  if (!stores.length) stores = await fetchOrgStores();
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Требования к покрытию точки';
  const modalBody = document.getElementById('modalBody');
  if (!modalBody) return;
  modalBody.innerHTML = `
      <div class="field">
        <label>Точка</label>
        <select id="staffingStoreSelect" onchange="loadStaffingEditorRows()">
          ${(stores || []).map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}
        </select>
      </div>
      <div id="staffingEditorRows"><div class="skeleton"></div></div>
      <button class="btn-main" onclick="saveStaffingEditor()">Сохранить</button>`;
  document.getElementById('overlay')?.classList.add('show');
  await loadStaffingEditorRows();
}

export async function loadStaffingEditorRows(): Promise<void> {
  const select = document.getElementById('staffingStoreSelect') as HTMLSelectElement | null;
  const box = document.getElementById('staffingEditorRows');
  if (!select || !box) return;
  const storeId = select.value;
  const org: { org_id?: string } = {};
  if (me?.role === 'admin' && adminViewOrgId) org.org_id = adminViewOrgId;
  let rows: StaffingRequirementRow[] = [];
  try {
    const data = await window.apiClient.getStaffingRequirements(authHeaders(), storeId, orgQueryParam());
    rows = data.rows || [];
  } catch {
    box.innerHTML = '<div class="empty">Ошибка загрузки</div>';
    return;
  }
  const byWeekday: Record<number, StaffingRequirementRow | undefined> = {};
  rows.filter((r) => r.weekday !== null).forEach((r) => {
    byWeekday[r.weekday as number] = r;
  });
  box.innerHTML =
    '<div class="empty" style="text-align:left;padding:0 0 8px">Требуемое число сотрудников и лимит стажёров по дням недели:</div>' +
    RU_WEEKDAY_LABELS.map((label, wd) => {
      const r = byWeekday[wd];
      return `<div class="field" style="display:flex;gap:8px;align-items:center">
          <label style="min-width:36px">${label}</label>
          <input type="number" min="0" id="staffReq_${wd}" value="${r ? r.required_employees : 0}" placeholder="чел." style="flex:1">
          <input type="number" min="0" id="staffMaxTr_${wd}" value="${r ? r.max_trainees : 1}" placeholder="стаж." style="flex:1">
        </div>`;
    }).join('');
}

export async function saveStaffingEditor(): Promise<void> {
  const select = document.getElementById('staffingStoreSelect') as HTMLSelectElement | null;
  if (!select) return;
  const storeId = select.value;
  const weekday_rows: { weekday: number; required_employees: number; max_trainees: number }[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const reqEl = document.getElementById(`staffReq_${wd}`) as HTMLInputElement | null;
    const maxTrEl = document.getElementById(`staffMaxTr_${wd}`) as HTMLInputElement | null;
    weekday_rows.push({ weekday: wd, required_employees: Number(reqEl?.value) || 0, max_trainees: Number(maxTrEl?.value) || 0 });
  }
  const body: { org_id?: string; weekday_rows: typeof weekday_rows } = { weekday_rows };
  if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
  try {
    await window.apiClient.saveStaffingRequirements(authHeaders(true), storeId, body);
    toast('Покрытие сохранено', 'ok');
    closeModal();
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
  }
}

// ===== Недоступность/отпуск сотрудника (employee_schedule_preferences) — минимальный редактор =====
export async function openAvailabilityEditor(): Promise<void> {
  if (!canManage()) return;
  const empParam = me?.role === 'admin' && adminViewOrgId ? '?org_id=' + encodeURIComponent(adminViewOrgId) : '';
  let emps: EmployeeListItem[] = [];
  try {
    emps = await window.apiClient.getEmployees(authHeaders(), empParam);
  } catch {
    /* пусто — select останется пустым, менеджер увидит ошибку при попытке загрузить строки */
  }
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Недоступность / отпуск сотрудника';
  const modalBody = document.getElementById('modalBody');
  if (!modalBody) return;
  modalBody.innerHTML = `
      <div class="field">
        <label>Сотрудник</label>
        <select id="availEmployeeSelect" onchange="loadAvailabilityEditorRows()">
          ${emps.map((e) => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('')}
        </select>
      </div>
      <div id="availabilityEditorRows"><div class="skeleton"></div></div>
      <div class="field" style="display:flex;gap:8px;align-items:flex-end">
        <div style="flex:1">
          <label>Тип</label>
          <select id="availKind">
            <option value="vacation">Отпуск</option>
            <option value="unavailable">Недоступен</option>
          </select>
        </div>
        <div style="flex:1">
          <label>Дата</label>
          <input type="date" id="availDate" value="${todayMoscow()}">
        </div>
      </div>
      <button class="btn-main" onclick="addAvailabilityRow()">Добавить</button>`;
  document.getElementById('overlay')?.classList.add('show');
  await loadAvailabilityEditorRows();
}

function availabilityKindLabel(kind: string): string {
  return kind === 'vacation' ? 'Отпуск' : kind === 'unavailable' ? 'Недоступен' : kind;
}

export async function loadAvailabilityEditorRows(): Promise<void> {
  const select = document.getElementById('availEmployeeSelect') as HTMLSelectElement | null;
  const box = document.getElementById('availabilityEditorRows');
  if (!select || !box || !select.value) return;
  const employeeId = Number(select.value);
  let rows: SchedulePreferenceRow[] = [];
  try {
    const data = await window.apiClient.getScheduleAvailability(authHeaders(), employeeId, orgQueryParam());
    rows = data.rows || [];
  } catch {
    box.innerHTML = '<div class="empty">Ошибка загрузки</div>';
    return;
  }
  box.innerHTML = !rows.length
    ? '<div class="empty" style="padding:6px 0">Нет отметок недоступности</div>'
    : rows
        .map(
          (r) => `<div class="row" style="padding:6px 0">
          <div class="row-body">
            <div class="row-title">${esc(availabilityKindLabel(r.kind))}</div>
            <div class="row-sub">${esc(String(r.specific_date || '').slice(0, 10))}</div>
          </div>
          <button class="btn-ghost" onclick="deleteAvailabilityRow(${employeeId}, ${r.id})">Убрать</button>
        </div>`
        )
        .join('');
}

export async function addAvailabilityRow(): Promise<void> {
  const select = document.getElementById('availEmployeeSelect') as HTMLSelectElement | null;
  const kindEl = document.getElementById('availKind') as HTMLSelectElement | null;
  const dateEl = document.getElementById('availDate') as HTMLInputElement | null;
  if (!select || !select.value || !kindEl || !dateEl || !dateEl.value) return;
  const employeeId = Number(select.value);
  const body: { org_id?: string; kind: 'unavailable' | 'vacation'; specific_date: string } = {
    kind: (kindEl.value as 'unavailable' | 'vacation') || 'vacation',
    specific_date: dateEl.value
  };
  if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
  try {
    await window.apiClient.addScheduleAvailability(authHeaders(true), employeeId, body);
    toast('Добавлено', 'ok');
    await loadAvailabilityEditorRows();
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
  }
}

export async function deleteAvailabilityRow(employeeId: number, rowId: number): Promise<void> {
  const body: { org_id?: string } = {};
  if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
  try {
    await window.apiClient.deleteScheduleAvailability(authHeaders(true), employeeId, rowId, body);
    await loadAvailabilityEditorRows();
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
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
    generateScheduleDraft: typeof generateScheduleDraft;
    applyScheduleDraftAction: typeof applyScheduleDraftAction;
    openStaffingEditor: typeof openStaffingEditor;
    loadStaffingEditorRows: typeof loadStaffingEditorRows;
    saveStaffingEditor: typeof saveStaffingEditor;
    openAvailabilityEditor: typeof openAvailabilityEditor;
    loadAvailabilityEditorRows: typeof loadAvailabilityEditorRows;
    addAvailabilityRow: typeof addAvailabilityRow;
    deleteAvailabilityRow: typeof deleteAvailabilityRow;
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
window.generateScheduleDraft = generateScheduleDraft;
window.applyScheduleDraftAction = applyScheduleDraftAction;
window.openStaffingEditor = openStaffingEditor;
window.loadStaffingEditorRows = loadStaffingEditorRows;
window.saveStaffingEditor = saveStaffingEditor;
window.openAvailabilityEditor = openAvailabilityEditor;
window.loadAvailabilityEditorRows = loadAvailabilityEditorRows;
window.addAvailabilityRow = addAvailabilityRow;
window.deleteAvailabilityRow = deleteAvailabilityRow;
