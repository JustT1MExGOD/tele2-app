/**
 * 21.x (Frontend rewrite continuation, batch of 13) — replacing
 * frontend/js/07-add-sale.js file-for-file: the shared "Добавить продажу"
 * modal (+ its swipe-to-close gesture) used across pages, plus the correction
 * flow and the generic #overlay open/close it owns.
 *
 * window.__saleClientId / window._schByEmp — only ever read within this same
 * file, replaced with private module variables (same precedent as
 * __taskClientId/__storeProfileDisplayName). window.__tutorialDryRun /
 * window.__tutorialDryRunCallback stay real window properties — written by
 * frontend/js/10-tutorial.js, still legacy and unmigrated.
 *
 * OfflineQueue: not part of this migration — a separate standalone script
 * (frontend/offline-queue.js), loaded via its own <script> tag, untouched.
 */
import type { EmployeeListItem, ScheduleRow, CreateSaleRequest } from '../../../../src/shared/api-types.js';

let saleClientId = '';
let schByEmp: Record<string, string> = {};

declare global {
  interface Window {
    __tutorialDryRun?: boolean;
    __tutorialDryRunCallback?: (() => void) | null;
  }
}

export async function openAddSale(presetEmployeeId?: number | string): Promise<void> {
  await loadMetricsCatalog();
  try {
    // Та же дыра, что и в карточке сотрудника/месячном графике — без org_id
    // admin при просмотре чужой сети видел бы в форме добавления продажи
    // СВОИХ сотрудников, а не сети, которую смотрит.
    const empParam = me?.role === 'admin' && adminViewOrgId ? '?org_id=' + encodeURIComponent(adminViewOrgId) : '';
    const [emps, storesData, schedules]: [EmployeeListItem[], any[], ScheduleRow[]] = await Promise.all([
      window.apiClient.getEmployees(authHeaders(), empParam),
      fetchOrgStores(),
      window.apiClient.getSchedules(authHeaders(), todayMoscow(), orgQueryParam())
    ]);
    employees = emps;
    stores = storesData;

    const byEmp: Record<string, string> = {};
    (Array.isArray(schedules) ? schedules : []).forEach((s) => {
      byEmp[s.employee_id] = s.store_id;
    });

    const isMgr = canManage();
    let empList: EmployeeListItem[] = employees || [];
    if (!isMgr && me?.employee_id) {
      empList = empList.filter((e) => String(e.id) === String(me!.employee_id));
      if (!empList.length) empList = [{ id: me.employee_id, full_name: me.full_name || 'Я' } as EmployeeListItem];
    }
    const defaultEmp = isMgr
      ? presetEmployeeId || me?.employee_id || (schedules[0] && schedules[0].employee_id) || empList[0]?.id
      : me?.employee_id || empList[0]?.id;
    const defaultStore = byEmp[String(defaultEmp)] || stores[0]?.id;

    saleSelection = {};
    const title = document.getElementById('modalTitle');
    if (title) title.textContent = 'Добавить продажу';
    const body = document.getElementById('modalBody');
    if (body) {
      body.innerHTML = `
          <div class="field">
            <label>Сотрудник</label>
            <select id="modalEmployee" onchange="onEmpChange()" ${isMgr ? '' : 'disabled'}>
              ${empList
                .map(
                  (e) =>
                    `<option value="${e.id}" ${String(e.id) === String(defaultEmp) ? 'selected' : ''}>${esc(e.full_name)}</option>`
                )
                .join('')}
            </select>
            ${isMgr ? '' : '<div style="font-size:12px;color:var(--hint);margin-top:4px">Можно вносить только свои продажи</div>'}
          </div>
          <div class="field">
            <label>Точка <span style="font-weight:500;text-transform:none;color:var(--primary)">(из графика)</span></label>
            <select id="modalStore">
              ${(stores || [])
                .map((s) => `<option value="${s.id}" ${s.id === defaultStore ? 'selected' : ''}>${esc(s.name)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="field">
            <label>Тип <span style="font-weight:500;text-transform:none;color:var(--text-secondary)">(можно несколько)</span></label>
            <div class="metric-grid" id="metricGrid"></div>
          </div>
          <div class="field">
            <label>Количество</label>
            <div id="saleQtyList" class="qty-list"></div>
            <div class="quick">
              <button type="button" onclick="setAllQty(1)">1</button>
              <button type="button" onclick="setAllQty(2)">2</button>
              <button type="button" onclick="setAllQty(5)">5</button>
              <button type="button" onclick="setAllQty(10)">10</button>
            </div>
          </div>
          <button class="btn-main" id="saleSubmitBtn" onclick="submitSale()">Добавить</button>
        `;
    }

    // Один client_id на всю сессию формы — если submitSale() ретраит
    // (ошибка сети) или пользователь дважды тапнул кнопку до того, как она
    // успела задизейблиться, бэкенд задедупит по этому же ключу вместо того
    // чтобы удвоить сумму продажи.
    saleClientId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();

    schByEmp = byEmp;
    renderSaleMetrics();
    document.getElementById('overlay')?.classList.add('show');
  } catch (e) {
    console.error(e);
    toast('Ошибка загрузки', 'err');
  }
}

export function onEmpChange(): void {
  const empSel = document.getElementById('modalEmployee') as HTMLSelectElement | null;
  const id = empSel?.value;
  const storeId = id ? schByEmp[id] : undefined;
  if (storeId) {
    const sel = document.getElementById('modalStore') as HTMLSelectElement | null;
    if (sel) sel.value = storeId;
  }
}

export function renderSaleMetrics(): void {
  const grid = document.getElementById('metricGrid');
  if (!grid) return;
  grid.innerHTML = METRICS.map(
    (m) => `
        <button type="button" class="mchip ${saleSelection[m.id] != null ? 'on' : ''}" data-m="${m.id}"
          onclick="toggleSaleMetric('${m.id}')">${m.label}</button>
      `
  ).join('');
  renderSaleQtyList();
}

export function toggleSaleMetric(id: string): void {
  if (saleSelection[id] != null) {
    delete saleSelection[id];
  } else {
    saleSelection[id] = 1;
  }
  renderSaleMetrics();
}

export function renderSaleQtyList(): void {
  const list = document.getElementById('saleQtyList');
  if (!list) return;
  const keys = Object.keys(saleSelection);
  if (!keys.length) {
    list.innerHTML = '<div class="qty-empty">Выбери одну или несколько метрик</div>';
    return;
  }
  list.innerHTML = keys
    .map((key) => {
      const m = METRICS.find((x) => x.id === key) || { label: key, unit: '' };
      return `
          <div class="qty-row">
            <div class="qty-label">${m.label}<small>${(m as any).unit || ''}</small></div>
            <input type="number" min="0" step="1" inputmode="decimal"
              value="${saleSelection[key]}"
              oninput="saleSelection['${key}'] = Number(String(this.value).replace(',','.')) || 0" />
          </div>
        `;
    })
    .join('');
}

export function setAllQty(n: number): void {
  Object.keys(saleSelection).forEach((k) => {
    saleSelection[k] = n;
  });
  renderSaleQtyList();
}

export function openModal(): void {
  const ov = document.getElementById('overlay');
  if (!ov) {
    console.error('overlay missing');
    return;
  }
  ov.classList.add('show');
}

export function closeModal(): void {
  document.getElementById('overlay')?.classList.remove('show');
  // Сброс на случай, если закрыли посреди свайпа (см. initModalSwipeClose
  // ниже) — иначе следующее открытие модалки унаследует смещение.
  const sheet = document.querySelector('.sheet-modal') as HTMLElement | null;
  if (sheet) {
    sheet.style.transform = '';
    sheet.style.transition = '';
    sheet.classList.remove('modal-sm', 'modal-md', 'modal-lg');
  }
}

export async function openCorrectSale(saleRow: any): Promise<void> {
  if (!saleRow) return;
  const isMgr = canManage();
  if (!isMgr && me?.employee_id && String(saleRow.employee_id) !== String(me.employee_id)) {
    toast('Нельзя править чужие продажи', 'err');
    return;
  }
  saleSelection = {};
  const title = document.getElementById('modalTitle');
  if (title) title.textContent = 'Исправить продажу (дельта)';
  const body = document.getElementById('modalBody');
  if (body) {
    body.innerHTML = `
        <div class="empty" style="text-align:left;padding:0 0 10px">
          Укажи <b>изменение</b>: −1 уменьшит, +1 добавит. Сотрудник: ${esc(saleRow.full_name || saleRow.employee_id)}
        </div>
        <input type="hidden" id="modalEmployee" value="${saleRow.employee_id}">
        <input type="hidden" id="modalStore" value="${saleRow.store_id}">
        <div class="field">
          <label>Метрики для правки</label>
          <div class="metric-grid" id="metricGrid"></div>
        </div>
        <div class="field">
          <label>Дельта</label>
          <div id="saleQtyList" class="qty-list"></div>
          <div class="quick">
            <button type="button" onclick="setAllQty(-1)">−1</button>
            <button type="button" onclick="setAllQty(1)">+1</button>
            <button type="button" onclick="setAllQty(-5)">−5</button>
          </div>
        </div>
        <button class="btn-main" onclick="submitSale()">Сохранить правку</button>
      `;
  }
  renderSaleMetrics();
  document.getElementById('overlay')?.classList.add('show');
}

export async function submitSale(): Promise<void> {
  const btn = document.getElementById('saleSubmitBtn') as HTMLButtonElement | null;
  // Дизейблим сразу — иначе нетерпеливый двойной тап на сенсорном экране
  // успевает уйти двумя запросами ДО того, как придёт первый ответ; client_id
  // ниже страхует и сетевые ретраи, но не отменяет смысла не плодить лишние
  // запросы на ровном месте.
  if (btn?.disabled) return;
  if (btn) btn.disabled = true;

  const employeeId = (document.getElementById('modalEmployee') as HTMLInputElement | HTMLSelectElement | null)?.value;
  const storeId = (document.getElementById('modalStore') as HTMLInputElement | HTMLSelectElement | null)?.value;
  if (!employeeId || !storeId) {
    toast('Укажи сотрудника и точку', 'err');
    if (btn) btn.disabled = false;
    return;
  }

  const payload: Record<string, any> = {
    employee_id: Number(employeeId),
    store_id: storeId,
    sale_date: todayMoscow(),
    client_id: saleClientId
  };
  if (me?.role === 'admin' && adminViewOrgId) payload.org_id = adminViewOrgId;

  let hasAny = false;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(saleSelection)) {
    const n = Number(v);
    if (n > 0) {
      payload[k] = n;
      hasAny = true;
      const m = METRICS.find((x) => x.id === k);
      parts.push((m ? m.label : k) + ' × ' + n);
    }
  }
  if (!hasAny) {
    toast('Выбери метрики и количество', 'err');
    if (btn) btn.disabled = false;
    return;
  }

  // Тренировочный режим обучения: форма настоящая, но запись в БД и в чат не
  // уходит — 10-tutorial.js ставит этот флаг перед openAddSale().
  if (window.__tutorialDryRun) {
    closeModal();
    toast('Тренировка: ' + parts.join(', ') + ' — по-настоящему это уйдёт в базу и в чат', 'ok');
    saleSelection = {};
    window.__tutorialDryRunCallback?.();
    if (btn) btn.disabled = false;
    return;
  }

  try {
    await window.apiClient.createSale(authHeaders(true), payload as CreateSaleRequest);
    closeModal();
    const streak = bumpStreak();
    const streakMsg =
      streak > 1
        ? ` · <svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" /> </svg> ${streak} дн.`
        : '';
    toast('Добавлено: ' + parts.join(', ') + streakMsg, 'ok');
    saleSelection = {};
    loadPage(page);
  } catch (e: any) {
    console.error(e);
    const msg = String(e?.message || e || '');
    // В очередь только реальная сеть (TypeError/Failed to fetch), не 400/403
    const isNetwork = /failed to fetch|network|load failed|offline/i.test(msg) || e?.name === 'TypeError';
    if (isNetwork && typeof OfflineQueue !== 'undefined') {
      try {
        const metrics: Record<string, number> = {};
        for (const [k, v] of Object.entries(saleSelection)) {
          const n = Number(v);
          if (n > 0) metrics[k] = n;
        }
        await OfflineQueue.enqueueSale({
          store_id: storeId,
          employee_id: Number(employeeId),
          metrics,
          sale_date: todayMoscow(),
          client_id: saleClientId
        });
        closeModal();
        saleSelection = {};
        toast('Нет сети — сохранено в очередь, уйдёт при Wi‑Fi', 'ok');
        return;
      } catch (e2) {
        console.error(e2);
      }
    }
    toast(msg && msg !== 'fail' ? msg : 'Ошибка сохранения', 'err');
    if (btn) btn.disabled = false;
  }
}

/* 15: свайп-вниз для закрытия модалки продажи. Жест ловим только на
   .sheet-modal (не на document) — и только если начался на ручке/заголовке, а
   не внутри #modalBody: иначе обычный скролл формы вниз тоже закрывал бы её.
   20.14.0 (apple-design skill): раньше решение "закрыть/вернуть" было чисто
   по дистанции (dy >= 80), а сеттл — CSS transition. Из-за этого быстрый флик
   на 20px не закрывал, а повторное хватание модалки ПОКА она ещё едет обратно
   вверх дёргало её в исходное положение — новый drag стартовал от dy=0, а не
   от текущего визуального Y, давая видимый скачок. Теперь решение учитывает
   скорость (флик закрывает даже на маленькой дистанции), а сеттл — через
   createSpring() (01-core.js), которую можно остановить и перезапустить от
   текущего значения в любой момент — это и есть перехватываемость жеста. */
export function initModalSwipeClose(): void {
  const sheet = document.querySelector('.sheet-modal') as HTMLElement | null;
  if (!sheet) return;
  const SWIPE_CLOSE_THRESHOLD = 80;
  const FLICK_VELOCITY = 500; // px/s — быстрый свайп закрывает даже на маленькой дистанции
  let startY = 0,
    dragBaseY = 0,
    dragging = false,
    history: { y: number; t: number }[] = [];
  let activeSpring: { stop: () => void; getValue: () => number } | null = null;

  function currentY(): number {
    if (activeSpring) return activeSpring.getValue();
    const m = /translateY\(([-\d.]+)px\)/.exec(sheet!.style.transform || '');
    return m ? parseFloat(m[1]) : 0;
  }

  sheet.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      if (!(e.target as HTMLElement).closest('.grab, .modal-title')) {
        dragging = false;
        return;
      }
      if (activeSpring) {
        activeSpring.stop();
        activeSpring = null;
      } // перехват на лету
      dragBaseY = currentY();
      startY = e.touches[0].clientY;
      history = [{ y: startY, t: performance.now() }];
      dragging = true;
    },
    { passive: true }
  );

  sheet.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (!dragging) return;
      const y = e.touches[0].clientY;
      history.push({ y, t: performance.now() });
      if (history.length > 5) history.shift();
      const dy = Math.max(0, dragBaseY + (y - startY));
      sheet.style.transform = `translateY(${dy}px)`;
    },
    { passive: true }
  );

  function endDrag(e: TouchEvent): void {
    if (!dragging) return;
    dragging = false;
    const y = e.changedTouches?.[0]?.clientY ?? startY;
    const dy = Math.max(0, dragBaseY + (y - startY));
    const velocity = gestureVelocity(history, 'y');

    const shouldClose = dy >= SWIPE_CLOSE_THRESHOLD || velocity >= FLICK_VELOCITY;
    const target = shouldClose ? sheet!.getBoundingClientRect().height + 40 : 0;
    const hasMomentum = Math.abs(velocity) > 200;

    activeSpring = createSpring({
      from: dy,
      velocity,
      to: target,
      damping: hasMomentum ? 0.86 : 1,
      response: 0.32,
      onUpdate: (v: number) => {
        sheet!.style.transform = `translateY(${v}px)`;
      },
      onSettle: () => {
        activeSpring = null;
        if (shouldClose) closeModal();
      }
    });
  }
  sheet.addEventListener('touchend', endDrag, { passive: true });
  sheet.addEventListener('touchcancel', endDrag, { passive: true });
}

document.getElementById('overlay')?.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id === 'overlay') closeModal();
});
initModalSwipeClose();

declare global {
  interface Window {
    openAddSale: typeof openAddSale;
    onEmpChange: typeof onEmpChange;
    toggleSaleMetric: typeof toggleSaleMetric;
    setAllQty: typeof setAllQty;
    openModal: typeof openModal;
    closeModal: typeof closeModal;
    openCorrectSale: typeof openCorrectSale;
    submitSale: typeof submitSale;
  }
}
window.openAddSale = openAddSale;
window.onEmpChange = onEmpChange;
window.toggleSaleMetric = toggleSaleMetric;
window.setAllQty = setAllQty;
window.openModal = openModal;
window.closeModal = closeModal;
window.openCorrectSale = openCorrectSale;
window.submitSale = submitSale;
