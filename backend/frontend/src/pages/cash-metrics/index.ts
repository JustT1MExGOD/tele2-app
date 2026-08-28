/**
 * 21.x (Frontend rewrite continuation, batch of 11) — replacing
 * frontend/js/09-cash-metrics.js file-for-file. Two unrelated concerns
 * bundled in one legacy file (cash table/entry, custom metrics admin) —
 * kept as one module here too, matching "file-for-file" rather than
 * splitting on our own judgment; the original's own `// ===== CASH =====`
 * / `// ===== CUSTOM METRICS =====` comments are preserved as section
 * markers below.
 *
 * `stores` (01-core.js) is the first shared legacy global this batch
 * WRITES to, not just reads — `declare let`, not `declare const`.
 */
import type { CashTableResponse, MetricDef } from '../../../../src/shared/api-types.js';

function deltaTone(d: number): string {
  if (d < -100) return 'background:#ff3b3033;color:#ff453a;font-weight:800';
  if (d > 100) return 'background:#34c75933;color:#34c759;font-weight:800';
  return 'background:#ffd96644;color:#c9a000;font-weight:700';
}

// ===== CASH =====

export async function loadCash(): Promise<void> {
  const box = document.getElementById('cashTable');
  const edit = document.getElementById('cashEditSection');
  if (edit) edit.style.display = 'block';
  if (box) box.innerHTML = '<div class="skeleton"></div>';
  try {
    if (!stores.length) {
      stores = await fetchOrgStores();
    }
    const sel = document.getElementById('cashStore') as HTMLSelectElement | null;
    if (sel) sel.innerHTML = stores.map((s: any) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    const dateInp = document.getElementById('cashDate') as HTMLInputElement | null;
    if (dateInp && !dateInp.value) dateInp.value = todayMoscow();

    const from = todayMoscow().slice(0, 8) + '01';
    const orgParam = me?.role === 'admin' && adminViewOrgId ? '&org_id=' + encodeURIComponent(adminViewOrgId) : '';
    const data: CashTableResponse = await window.apiClient.getCashTable(authHeaders(), from, todayMoscow(), orgParam);
    const stList = data.stores || stores;
    const dates = data.dates || [];
    const cells = data.cells || {};

    if (!box) return;
    if (!dates.length) {
      box.innerHTML = '<div class="empty">🍉 Пока нет ни одной записи кассы — внеси первую строку ниже</div>';
      return;
    }

    const dayHtml = (d: string): string => {
      const rows = stList
        .map((s: any) => {
          const c: any = (cells[d] && (cells as any)[d][s.id]) || {};
          const fact = c.cash_fact;
          const c1 = c.cash_1c;
          const delta = c.delta != null ? Number(c.delta) : fact != null && c1 != null ? Number(fact) - (Number(c1) + 2000) : null;
          const dClass = delta == null ? '' : delta >= 0 ? 'delta-pos' : 'delta-neg';
          const click = `onclick="fillCashForm('${s.id}','${d}',${Number(fact) || 0},${Number(c1) || 0})"`;
          return `<div class="cash-row" ${click} style="${click ? 'cursor:pointer' : ''}">
              <div class="sn">${esc(s.name || s.id)}</div>
              <div>${fact != null && fact !== '' ? Number(fact).toLocaleString('ru-RU') : '—'}</div>
              <div>${c1 != null && c1 !== '' ? Number(c1).toLocaleString('ru-RU') : '—'}</div>
              <div class="${dClass}">${delta == null || (delta as any) === '' ? '—' : (delta > 0 ? '+' : '') + Number(delta).toLocaleString('ru-RU')}</div>
            </div>`;
        })
        .join('');
      const label = String(d).slice(8, 10) + '.' + String(d).slice(5, 7) + '.' + String(d).slice(2, 4);
      return `<div class="cash-day">
            <div class="cash-day-h"><span>${label}</span></div>
            <div class="cash-cols"><div>Точка</div><div>Факт</div><div>1С</div><div>Δ (−2000)</div></div>
            ${rows}</div>`;
    };

    // 14: только 2 последних дня сразу, остальное — по клику (тот же
    // .mt-toggle/.mt-extra паттерн, что «Прогресс за месяц» и «Планы и
    // факт за месяц» — dates уже по возрастанию даты).
    const recent = dates.slice(-2);
    const rest = dates.slice(0, -2);
    box.innerHTML =
      recent.map(dayHtml).join('') +
      (rest.length
        ? `
          <div class="mt-more">
            <button type="button" class="mt-toggle" onclick="toggleMonthExtra('cashExtraDays', this, 'Свернуть ▴', 'Ещё дни ▾')">Ещё дни ▾</button>
            <div class="sv-extra" id="cashExtraDays">${rest.slice().reverse().map(dayHtml).join('')}</div>
          </div>`
        : '');
  } catch (e) {
    console.error(e);
    if (box) box.innerHTML = '<div class="empty">🍉 Касса сейчас недоступна, зайди чуть позже</div>';
  }
}

export function fillCashForm(storeId: string, date: string, fact: number, c1: number): void {
  (document.getElementById('cashStore') as HTMLSelectElement).value = storeId;
  (document.getElementById('cashDate') as HTMLInputElement).value = date;
  (document.getElementById('cashFact') as HTMLInputElement).value = String(fact);
  (document.getElementById('cash1c') as HTMLInputElement).value = String(c1);
  document.getElementById('cashEditSection')?.scrollIntoView({ behavior: 'smooth' });
}

export async function saveCash(): Promise<void> {
  // кассу вносят все сотрудники на точке (не только manager)
  if (!me?.employee_id && !(me as any)?.id) {
    toast('Нужна авторизация', 'err');
    return;
  }
  const body: any = {
    store_id: (document.getElementById('cashStore') as HTMLSelectElement).value,
    cash_date: (document.getElementById('cashDate') as HTMLInputElement).value || todayMoscow(),
    cash_fact: Number((document.getElementById('cashFact') as HTMLInputElement).value) || 0,
    cash_1c: Number((document.getElementById('cash1c') as HTMLInputElement).value) || 0,
    comment: (document.getElementById('cashComment') as HTMLInputElement).value || ''
  };
  if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
  try {
    await window.apiClient.saveCash(authHeaders(true), body);
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    return;
  }
  toast('Касса сохранена', 'ok');
  loadCash();
}

// ===== CUSTOM METRICS =====

// Базовые метрики защищены от удаления и на бэкенде (DELETE /metrics/:id);
// список здесь только чтобы не показывать бесполезную кнопку «Удалить».
const LOCKED_METRICS = new Set([
  'sim', 'mnp', 'pa', 'combo', 'phones', 'accessories', 'settings',
  'insurance', 'wink', 'shpd', 'focus', 'credit_request', 'credit_issued',
  'plotter', 'hb', 'credit'
]);

export async function openAddMetric(): Promise<void> {
  if (!canManage()) return;
  await loadMetricsCatalog();
  const title = document.getElementById('modalTitle');
  if (title) title.textContent = 'Метрики плана';
  const custom = ((METRICS as MetricDef[]) || []).filter((m) => !LOCKED_METRICS.has(m.id));
  const listHtml = custom.length
    ? `<div class="block-label">Свои метрики</div>
           <div class="progress-block" style="display:flex;flex-direction:column;gap:8px">
             ${custom
               .map(
                 (m) => `
               <div style="display:flex;justify-content:space-between;align-items:center">
                 <span style="font-size:14px">${esc(m.label)} <span style="color:var(--hint)">(${esc(m.id)})</span></span>
                 <button class="mchip" style="color:var(--danger)" onclick="${esc(`deleteMetric('${m.id}',${JSON.stringify(m.label)})`)}">Удалить</button>
               </div>`
               )
               .join('')}
           </div>`
    : '';
  const body = document.getElementById('modalBody');
  if (body) {
    body.innerHTML = `
        ${listHtml}
        <div class="block-label">Новая метрика</div>
        <div class="field"><label>Название</label><input id="nm_label" placeholder="Например: eSIM"></div>
        <div class="field"><label>Короткое</label><input id="nm_short" placeholder="eSIM"></div>
        <div class="field"><label>Тип</label>
          <select id="nm_unit">
            <option value="count">Количество</option>
            <option value="money">Деньги</option>
          </select>
        </div>
        <button class="btn-main" onclick="saveMetric()">Создать</button>
      `;
  }
  document.getElementById('overlay')?.classList.add('show');
}

export async function deleteMetric(id: string, label: string): Promise<void> {
  if (!canManage()) return;
  if (!confirm(`Удалить метрику «${label}»? Она перестанет показываться в формах — уже внесённые по ней данные останутся в базе.`)) return;
  try {
    await window.apiClient.deleteMetric(authHeaders(), id);
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    return;
  }
  toast('Метрика удалена', 'ok');
  await openAddMetric();
}

export async function saveMetric(): Promise<void> {
  const label = (document.getElementById('nm_label') as HTMLInputElement).value.trim();
  if (!label) {
    toast('Укажи название', 'err');
    return;
  }
  let data: any;
  try {
    data = await window.apiClient.createMetric(authHeaders(true), {
      label,
      short_label: (document.getElementById('nm_short') as HTMLInputElement).value.trim() || label.slice(0, 8),
      unit: (document.getElementById('nm_unit') as HTMLSelectElement).value
    });
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    return;
  }
  toast('Метрика «' + (data.item?.label || label) + '» добавлена', 'ok');
  closeModal();
  await loadMetricsCatalog();
}

declare global {
  interface Window {
    loadCash: typeof loadCash;
    fillCashForm: typeof fillCashForm;
    saveCash: typeof saveCash;
    openAddMetric: typeof openAddMetric;
    deleteMetric: typeof deleteMetric;
    saveMetric: typeof saveMetric;
  }
}
window.loadCash = loadCash;
window.fillCashForm = fillCashForm;
window.saveCash = saveCash;
window.openAddMetric = openAddMetric;
window.deleteMetric = deleteMetric;
window.saveMetric = saveMetric;
