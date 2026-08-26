/**
 * 21.x (Frontend rewrite continuation, batch of 13) — replacing
 * frontend/js/06b-plans-bfq.js file-for-file: BFQ-скоринг, месячные планы
 * сотрудников, «Сеть за месяц» (барный вид), дневные/месячные планы точек.
 *
 * storeDailyPlanNames stays a private module variable — only ever read/
 * written within this same file's functions (cache to avoid passing a
 * store name with quotes through an onclick attribute string).
 */
import type {
  MonthSummaryTableResponse,
  StoreMonthSummaryTableResponse,
  EmployeeMonthPlanResponse,
  StoreDailyPlansResponse,
  StoreMonthPlanResponse,
  BfqListResponse,
  BfqEmployeeResponse,
  SaveMonthPlanRequest
} from '../../../../src/shared/api-types.js';

// ===== BFQ =====
export async function loadBFQ(): Promise<void> {
  const box = document.getElementById('bfqList');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const month = scheduleMonth || todayMoscow().slice(0, 7);
    const data: BfqListResponse | any = await window.apiClient.getBfqList(authHeaders(), month, orgQueryParam());
    const list = Array.isArray(data) ? data : data.items || [];
    if (!list.length) {
      box.innerHTML = '<div class="empty">Нет данных BFQ</div>';
      return;
    }
    box.innerHTML = list
      .map(
        (e: any, i: number) => `
          <button class="row" onclick="openBFQCard(${e.employee_id})">
            <div class="row-icon">${i + 1}</div>
            <div class="row-body">
              <div class="row-title">${esc(e.full_name || e.name)}</div>
              <div class="row-sub">Кач. ${e.quality ?? '—'} · Приб. ${e.profit ?? '—'} · VMR ${e.vmr ?? 0}</div>
            </div>
            <div class="row-value">${e.total ?? e.bfq ?? '—'}</div>
            <div class="row-chevron">›</div>
          </button>
        `
      )
      .join('');
  } catch {
    box.innerHTML = '<div class="empty">Ошибка BFQ</div>';
  }
}

export async function openBFQCard(id: number): Promise<void> {
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'BFQ';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) modalBody.innerHTML = '<div class="empty">Загрузка…</div>';
  document.getElementById('overlay')?.classList.add('show');
  try {
    const month = todayMoscow().slice(0, 7);
    const d: BfqEmployeeResponse = await window.apiClient.getBfqEmployee(authHeaders(), id, month, orgQueryParam());
    const f: any = d.fact || {};
    const fc: any = d.forecast || {};
    let manual = '';
    if (canManage()) {
      manual = `
            <div class="field"><label>VMR средний</label>
              <input type="number" id="bfqVmr" value="${f.vmr || 0}" step="0.1"></div>
            <div class="field"><label>Штраф</label>
              <input type="number" id="bfqPenalty" value="${f.penalty || 0}" step="0.1"></div>
            <button class="btn-main" onclick="saveBFQManual(${id})">Сохранить VMR / штраф</button>`;
    }
    if (modalBody) {
      modalBody.innerHTML = `
          <div class="stats-row">
            <div class="stat-chip"><div class="n">${f.total ?? '—'}</div><div class="l">Факт</div></div>
            <div class="stat-chip"><div class="n">${fc.total ?? '—'}</div><div class="l">Прогноз</div></div>
            <div class="stat-chip"><div class="n">${f.quality ?? '—'}</div><div class="l">Качество</div></div>
          </div>
          <div class="progress-block">
            ${progressHTML('GI', f.blocks?.gi, 50)}
            ${progressHTML('VMR блок', f.blocks?.vmr, 12)}
            ${progressHTML('Digital', f.blocks?.digital, 25)}
            ${progressHTML('Top-up', f.blocks?.topUp, 15)}
            ${progressHTML('Прибыль', f.profit, 20)}
          </div>
          <div class="empty" style="padding:8px 0">
            Смены: ${d.shifts?.worked || 0} отработано · ${d.shifts?.remaining || 0} осталось
          </div>
          ${manual}`;
    }
  } catch {
    const modalBody2 = document.getElementById('modalBody');
    if (modalBody2) modalBody2.innerHTML = '<div class="empty">Ошибка</div>';
  }
}

export async function saveBFQManual(employeeId: number): Promise<void> {
  const vmr = Number((document.getElementById('bfqVmr') as HTMLInputElement | null)?.value) || 0;
  const penalty = Number((document.getElementById('bfqPenalty') as HTMLInputElement | null)?.value) || 0;
  const month = todayMoscow().slice(0, 7);
  const body: { employee_id: number; month: string; vmr_avg: number; penalty: number; org_id?: string } = {
    employee_id: employeeId,
    month,
    vmr_avg: vmr,
    penalty
  };
  if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
  try {
    await window.apiClient.saveBfqManual(authHeaders(true), body);
  } catch (e) {
    toast('Нет прав или ошибка', 'err');
    return;
  }
  toast('Сохранено', 'ok');
  closeModal();
  loadBFQ();
}

// ===== Планы сотрудников за месяц =====
export async function loadMonthPlans(): Promise<void> {
  const box = document.getElementById('monthPlanList');
  const meta = document.getElementById('monthPlanMeta');
  const label = document.getElementById('planMonthLabel');
  if (!planMonth) planMonth = todayMoscow().slice(0, 7);
  if (label) label.textContent = monthLabel(planMonth);
  if (box) box.innerHTML = '<div class="skeleton"></div>';
  try {
    const data: MonthSummaryTableResponse = await window.apiClient.getPlansEmployeesMonth(authHeaders(), planMonth, orgQueryParam());
    const rows = data.rows || [];
    if (meta) {
      meta.innerHTML = `Сотрудников: <b>${rows.length}</b> · ост. дней: <b>${data.remaining_days ?? '—'}</b>`;
    }

    const MAIN = METRICS.slice(0, 6).map((x) => ({ id: x.id, label: x.label }));
    const EXTRA = METRICS.slice(6).map((x) => ({ id: x.id, label: x.label }));

    function cell(m: { id: string; label: string }, fact: Record<string, number>, pct: Record<string, number>): string {
      const f = Number(fact[m.id]) || 0;
      const pc = Number(pct[m.id]) || 0;
      const tone = pc >= 100 ? 'good' : pc >= 50 ? 'warn' : f > 0 ? '' : 'bad';
      return `<div class="mt-cell ${tone}"><div class="v">${f}</div><div class="l">${m.label}</div></div>`;
    }

    if (!rows.length) {
      if (box) box.innerHTML = '<div class="empty">Нет данных за ' + planMonth + '</div>';
      if (typeof loadStoreDailyPlans === 'function') loadStoreDailyPlans();
      return;
    }

    let html =
      '<div class="mobile-table">' +
      rows
        .map((r, idx) => {
          const plan = r.plan || {};
          const fact = r.fact || {};
          const pct = r.pct || {};
          const nameClick = canManage() ? `onclick="event.stopPropagation();editEmployeeMonthPlan(${r.employee_id}, '${String(r.full_name || '').replace(/'/g, "\\'")}')"` : '';
          const mainCells = MAIN.map((m) => cell(m, fact, pct)).join('');
          const extraCells = EXTRA.map((m) => cell(m, fact, pct)).join('');
          const eid = 'mpx-' + idx;
          return `<div class="mt-card">
            <div class="mt-card-head" ${nameClick} style="${nameClick ? 'cursor:pointer' : ''}">
              <div>
                <div class="mt-name">${esc(r.full_name || '')}</div>
                <div class="mt-meta">${r.role || ''} · смен ${r.shifts || 0} · ост. ${r.remaining_shifts || 0}</div>
              </div>
            </div>
            <div class="mt-grid">${mainCells}</div>
            <div class="mt-more">
              <button type="button" class="mt-toggle" onclick="toggleMonthExtra('${eid}', this)">Ещё метрики ▾</button>
              <div class="mt-extra" id="${eid}">${extraCells}</div>
            </div>
          </div>`;
        })
        .join('') +
      '</div>';

    const tf = (data.totals && data.totals.fact) || null;
    // data.totals.pct тоже существовал в ответе (getMonthSummaryTable()),
    // просто раньше не читался — карточка всегда рендерилась без тона
    // (зелёный/жёлтый), потому что cell() получала пустой {} вместо pct.
    const tp = (data.totals && data.totals.pct) || {};
    if (tf) {
      html += `<div class="mt-card" style="margin:0 12px 16px;border-color:var(--primary)">
            <div class="mt-name" style="margin-bottom:10px">Итого сеть · ${planMonth}</div>
            <div class="mt-grid">${MAIN.map((m) => cell(m, tf, tp)).join('')}</div>
            <div class="mt-more">
              <button type="button" class="mt-toggle" onclick="toggleMonthExtra('mpx-tot', this)">Ещё метрики ▾</button>
              <div class="mt-extra" id="mpx-tot">${EXTRA.map((m) => cell(m, tf, tp)).join('')}</div>
            </div>
          </div>`;
    }
    if (box) box.innerHTML = html;
    if (typeof loadStoreDailyPlans === 'function') loadStoreDailyPlans();
  } catch (e) {
    console.error(e);
    if (box) box.innerHTML = '<div class="empty">Планы месяца недоступны</div>';
  }
}

export function shiftPlanMonth(delta: number): void {
  const [y, m] = planMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  planMonth = d.toISOString().slice(0, 7);
  loadMonthPlans();
}

// «Сеть за месяц» — все 15 метрик сразу, план/факт/% всей команды сети,
// строками-барами (тот же стиль, что кабинет супервайзера, svBarRowHTML/
// svBarColor из 08-access-supervisor.js — переиспользуем как есть, это тот
// же общий global scope). Данные те же, что и «Итого сеть» на «Планы и факт
// за месяц» (GET /plans/employees/month, data.totals) — просто отдельная
// быстрая вкладка без разбивки по сотрудникам.
export function shiftNetMonth(delta: number): void {
  const [y, m] = planMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  planMonth = d.toISOString().slice(0, 7);
  loadNetMonth();
}

export async function loadNetMonth(): Promise<void> {
  const box = document.getElementById('netMonthBody');
  const label = document.getElementById('netMonthLabel');
  if (!box) return;
  if (label) label.textContent = planMonth;
  box.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    // «Динамика выполнения» (переименовано из «...по сотрудникам» — теперь
    // две равноправные разбивки одного и того же месяца, не одна) — по
    // сотрудникам и по точкам получены параллельно, один общий рендер
    // ниже (renderNetMonthSection) на обе.
    const [empData, storeData]: [MonthSummaryTableResponse, StoreMonthSummaryTableResponse] = await Promise.all([
      window.apiClient.getPlansEmployeesMonth(authHeaders(), planMonth, orgQueryParam()),
      window.apiClient.getPlansStoresMonth(authHeaders(), planMonth, orgQueryParam())
    ]);
    const totals = empData.totals || {};
    const fact = totals.fact || {};
    const plan = totals.plan || {};
    const netRows = METRICS.map((m) => svBarRowHTML(m.label, Number(fact[m.id]) || 0, Number(plan[m.id]) || 0)).join('');
    let html =
      `<div class="sv-store" style="--sc:#2AABEE"><div class="sv-bars">${netRows}</div></div>` +
      `<div class="empty" style="text-align:left;padding:8px 16px">Сотрудников: ${empData.rows ? empData.rows.length : 0} · ост. дней: ${empData.remaining_days ?? '—'}</div>`;

    html += renderNetMonthSection(
      'По сотрудникам',
      'nme-',
      empData.rows || [],
      (r: any) => esc(r.full_name || ''),
      (r: any) => `${roleLabel(r.role || '')} · смен ${r.shifts || 0} · ост. ${r.remaining_shifts || 0}`,
      (r: any) => r.fact || {},
      (r: any) => r.plan || {}
    );
    html += renderNetMonthSection(
      'По точкам',
      'nms-',
      storeData.rows || [],
      (r: any) => esc(r.name || ''),
      (r: any) => esc(r.code || ''),
      (r: any) => r.fact || {},
      (r: any) => r.plan || {}
    );

    box.innerHTML = html;
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить</div>';
  }
}

// Общий рендер для «По сотрудникам»/«По точкам» (loadNetMonth) — тот же
// барный стиль, что у сети целиком, MAIN(6)/EXTRA(9) сплит, что и на
// «Планы и факт за месяц», просто другой визуал. idPrefix — чтобы
// svExtraToggleHTML() (глобальный toggle по id) не путал сотрудников и
// точки при одинаковом индексе.
function renderNetMonthSection<T>(
  title: string,
  idPrefix: string,
  rows: T[],
  nameOf: (r: T) => string,
  subOf: (r: T) => string,
  factOf: (r: T) => Record<string, unknown>,
  planOf: (r: T) => Record<string, unknown>
): string {
  if (!rows.length) return '';
  const mainIds = METRICS.slice(0, 6);
  const extraIds = METRICS.slice(6);
  const cards = rows
    .map((r, idx) => {
      const ef = factOf(r);
      const ep = planOf(r);
      const mainRows = mainIds.map((m) => svBarRowHTML(m.label, Number(ef[m.id]) || 0, Number(ep[m.id]) || 0)).join('');
      const extraRows = extraIds.map((m) => svBarRowHTML(m.label, Number(ef[m.id]) || 0, Number(ep[m.id]) || 0)).join('');
      return `<div class="sv-store" style="--sc:#2AABEE">
          <div class="sv-store-head">
            <div>
              <div class="sv-store-name">${nameOf(r)}</div>
              <div class="sv-store-code">${subOf(r)}</div>
            </div>
          </div>
          <div class="sv-bars">${mainRows}</div>
          ${svExtraToggleHTML(idPrefix + idx, extraRows)}
        </div>`;
    })
    .join('');
  return `<div class="sv-section">${title}</div>${cards}`;
}

export function toggleMonthExtra(id: string, btn?: HTMLElement | null, openLabel?: string, closedLabel?: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const open = el.classList.toggle('open');
  if (btn) btn.textContent = open ? openLabel || 'Свернуть ▴' : closedLabel || 'Ещё метрики ▾';
}

export async function editEmployeeMonthPlan(employeeId: number, name?: string): Promise<void> {
  if (!canManage()) return;
  await loadMetricsCatalog();
  const month = planMonth || scheduleMonth || todayMoscow().slice(0, 7);
  const p: any = await window.apiClient.getEmployeeMonthPlan(authHeaders(), employeeId, month).catch(() => ({}));
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'План: ' + (name || employeeId);
  const fields = METRICS.map((m) => {
    let val = p[m.id];
    if (val == null && m.id === 'credit_issued') val = p.credit;
    return '<div class="field"><label>' + m.label + ((m as any).unit ? ' (' + (m as any).unit + ')' : '') + '</label>' + '<input type="number" id="mp_' + m.id + '" value="' + (Number(val) || 0) + '"></div>';
  }).join('');
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML =
      '<div class="empty" style="text-align:left;padding:0 0 12px">Месяц ' + month + '. Дневной = остаток / смены.</div>' + fields + '<button class="btn-main" onclick="saveEmployeeMonthPlan(' + employeeId + ')">Сохранить</button>';
  }
  document.getElementById('overlay')?.classList.add('show');
}

export async function saveEmployeeMonthPlan(employeeId: number): Promise<void> {
  const month = planMonth || scheduleMonth || todayMoscow().slice(0, 7);
  const body: Record<string, any> = { month };
  for (const m of METRICS) {
    const el = document.getElementById('mp_' + m.id) as HTMLInputElement | null;
    if (el) body[m.id] = Number(el.value) || 0;
  }
  if (body.credit_issued != null) body.credit = body.credit_issued;
  try {
    await window.apiClient.saveEmployeeMonthPlan(authHeaders(true), employeeId, body as SaveMonthPlanRequest);
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    return;
  }
  toast('План сохранён', 'ok');
  closeModal();
  if (typeof loadMonthPlans === 'function') loadMonthPlans();
}

// ===== Планы точек: дневной расчёт + ручной ввод месячного плана =====
// Кэш имён точек последней загрузки — чтобы не передавать имя через
// onclick-атрибут строкой (кавычки в названии точки уже ломали такое раньше).
let storeDailyPlanNames: Record<string, string> = {};

export async function loadStoreDailyPlans(): Promise<void> {
  const box = document.getElementById('storeDailyPlans');
  if (!box) return;
  try {
    const data: StoreDailyPlansResponse = await window.apiClient.getStoreDailyPlans(authHeaders(), orgQueryParam());
    const storesList = data.stores || [];
    storeDailyPlanNames = {};
    storesList.forEach((st) => {
      storeDailyPlanNames[st.store_id] = st.name;
    });
    if (!storesList.length) {
      box.innerHTML = '<div class="empty">Нет данных</div>';
      return;
    }
    const editable = canManage();
    box.innerHTML = storesList
      .map((st) => {
        const col = storeColor(st.store_id, st as any);
        const p = st.plan || {};
        const initial = (st.name || '?').slice(0, 2).toUpperCase();
        const chips = METRICS.slice(0, 8)
          .map((m) => `<div class="stat-chip"><div class="n">${(p as any)[m.id] || 0}</div><div class="l">${m.label}</div></div>`)
          .join('');
        const click = editable ? `onclick="editStoreMonthPlan('${st.store_id}')" style="cursor:pointer"` : 'style="cursor:default"';
        return `
            <div class="store-card" style="border-left:4px solid ${col};margin:8px 12px">
              <div class="store-head" ${click}>
                <div class="store-badge" style="background:${col}33;color:${col}">${initial}</div>
                <div class="store-meta">
                  <div class="store-name">${st.name}</div>
                  <div class="store-code">${st.code || ''} · дневной план${st.has_plan ? '' : ' · план на месяц не задан'}</div>
                </div>
                ${editable ? '<div class="row-chevron">›</div>' : ''}
              </div>
              <div class="stats-row" style="padding:0 12px 12px">${chips}</div>
            </div>`;
      })
      .join('');
    // Кнопка «Записать дневные планы в БД» убрана (19.3) — оба случая, ради
    // которых её нажимали, давно автоматизированы: ежедневный крон в 6:00
    // МСК (cron/reports.ts) и мгновенный пересчёт сразу при правке плана
    // точки (routes-plans-v5.ts, PUT /plans/stores/:id/month).
  } catch {
    box.innerHTML = '<div class="empty">Дневные планы точек пока недоступны</div>';
  }
}

// План точки на месяц — вручную, независимо от планов сотрудников (эпик
// 17.0: убрали распределение по долям, точка теперь ведёт свой план сама).
export async function editStoreMonthPlan(storeId: string): Promise<void> {
  if (!canManage()) return;
  await loadMetricsCatalog();
  const month = todayMoscow().slice(0, 7);
  const name = storeDailyPlanNames[storeId] || storeId;
  const p: any = await window.apiClient.getStoreMonthPlan(authHeaders(), storeId, month).catch(() => ({}));
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'План точки: ' + name;
  const fields = METRICS.map((m) => {
    let val = p[m.id];
    if (val == null && m.id === 'credit_issued') val = p.credit;
    return '<div class="field"><label>' + m.label + ((m as any).unit ? ' (' + (m as any).unit + ')' : '') + '</label>' + '<input type="number" id="smp_' + m.id + '" value="' + (Number(val) || 0) + '"></div>';
  }).join('');
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML =
      '<div class="empty" style="text-align:left;padding:0 0 12px">Месяц ' + month + ', план на всю точку целиком. Дневной = остаток / оставшиеся дни.</div>' +
      fields +
      '<button class="btn-main" onclick="saveStoreMonthPlan(\'' + storeId + '\')">Сохранить</button>';
  }
  document.getElementById('overlay')?.classList.add('show');
}

export async function saveStoreMonthPlan(storeId: string): Promise<void> {
  const month = todayMoscow().slice(0, 7);
  const body: Record<string, any> = { month };
  for (const m of METRICS) {
    const el = document.getElementById('smp_' + m.id) as HTMLInputElement | null;
    if (el) body[m.id] = Number(el.value) || 0;
  }
  if (body.credit_issued != null) body.credit = body.credit_issued;
  // Точка уже пришла из списка, отфильтрованного переключателем сети — без
  // org_id бэкенд резолвит orgId в СВОЮ сеть admin'а и 403-ит на чужой точке
  // (assertStoreInOrg), хотя сама точка видна в списке.
  if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
  try {
    await window.apiClient.saveStoreMonthPlan(authHeaders(true), storeId, body as SaveMonthPlanRequest);
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    return;
  }
  toast('План точки сохранён', 'ok');
  closeModal();
  if (typeof loadStoreDailyPlans === 'function') loadStoreDailyPlans();
}

declare global {
  interface Window {
    loadBFQ: typeof loadBFQ;
    openBFQCard: typeof openBFQCard;
    saveBFQManual: typeof saveBFQManual;
    loadMonthPlans: typeof loadMonthPlans;
    shiftPlanMonth: typeof shiftPlanMonth;
    shiftNetMonth: typeof shiftNetMonth;
    loadNetMonth: typeof loadNetMonth;
    toggleMonthExtra: typeof toggleMonthExtra;
    editEmployeeMonthPlan: typeof editEmployeeMonthPlan;
    saveEmployeeMonthPlan: typeof saveEmployeeMonthPlan;
    loadStoreDailyPlans: typeof loadStoreDailyPlans;
    editStoreMonthPlan: typeof editStoreMonthPlan;
    saveStoreMonthPlan: typeof saveStoreMonthPlan;
  }
}
window.loadBFQ = loadBFQ;
window.openBFQCard = openBFQCard;
window.saveBFQManual = saveBFQManual;
window.loadMonthPlans = loadMonthPlans;
window.shiftPlanMonth = shiftPlanMonth;
window.shiftNetMonth = shiftNetMonth;
window.loadNetMonth = loadNetMonth;
window.toggleMonthExtra = toggleMonthExtra;
window.editEmployeeMonthPlan = editEmployeeMonthPlan;
window.saveEmployeeMonthPlan = saveEmployeeMonthPlan;
window.loadStoreDailyPlans = loadStoreDailyPlans;
window.editStoreMonthPlan = editStoreMonthPlan;
window.saveStoreMonthPlan = saveStoreMonthPlan;
