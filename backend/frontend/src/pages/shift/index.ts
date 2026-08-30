/**
 * 21.x (Frontend rewrite continuation, batch of 13) — replacing
 * frontend/js/11-v13.js file-for-file: смена-сессия (открытие/закрытие +
 * бриф/результат), «Мой план» виджет смена+инсайт+геймификация, быстрый ввод
 * продажи по фразе, живая карта сети, комбо/школа калькуляторы, confetti.
 *
 * window.__quickSaleClientId — only ever read/written within this same file,
 * replaced with a private module variable (same precedent as
 * __taskClientId/__saleClientId). Dropped the dead `_loadMyPlanOrig` const
 * from the original (assigned, never read — an abandoned refactor note per
 * its own comment, no behavior to preserve).
 */
import type {
  ShiftOpenResponse,
  ShiftCloseResponse,
  ShiftCurrentResponse,
  MyInsightResponse,
  SelfStatsResponse,
  NetworkLiveResponse
} from '../../../../src/shared/api-types.js';

async function geoCoords(): Promise<{ lat: number | null; lng: number | null; accuracy_m: number | null }> {
  try {
    const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000 }));
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy
    };
  } catch (_) {
    return { lat: null, lng: null, accuracy_m: null };
  }
}

export function openComboCalc(): void {
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Расчёт комбо';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
        <div class="empty" style="text-align:left;padding:0 0 12px;line-height:1.45">
          Формула T2:<br><b>цена − скидка% + 28% от цены + 1950</b>
        </div>
        <div class="field">
          <label>Цена телефона, ₽</label>
          <input type="number" id="comboPrice" placeholder="29990" inputmode="decimal">
        </div>
        <div class="field">
          <label>Скидка, %</label>
          <input type="number" id="comboDiscount" value="0" inputmode="decimal">
        </div>
        <button type="button" class="btn-main" onclick="runComboCalc()">Посчитать</button>
        <div id="comboOut" style="display:none" class="combo-result"></div>
      `;
  }
  try {
    if (typeof openModal === 'function') openModal();
    else document.getElementById('overlay')?.classList.add('show');
  } catch (e) {
    console.error(e);
    document.getElementById('overlay')?.classList.add('show');
  }
  setTimeout(() => (document.getElementById('comboPrice') as HTMLInputElement | null)?.focus(), 200);
}

export function runComboCalc(): void {
  const price = Number((document.getElementById('comboPrice') as HTMLInputElement | null)?.value) || 0;
  const disc = Number((document.getElementById('comboDiscount') as HTMLInputElement | null)?.value) || 0;
  if (price <= 0) {
    toast('Укажи цену', 'err');
    return;
  }
  const afterDisc = price * (1 - disc / 100);
  const total = Math.round(afterDisc + price * 0.28 + 1950);
  const el = document.getElementById('comboOut');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `
        <div class="big">${total.toLocaleString('ru-RU')} ₽</div>
        <div class="hint">
          ${price.toLocaleString('ru-RU')} − ${disc}% = ${Math.round(afterDisc).toLocaleString('ru-RU')}<br>
          + 28% (${Math.round(price * 0.28).toLocaleString('ru-RU')}) + 1 950
        </div>`;
  try {
    (window as any).tg?.HapticFeedback?.impactOccurred?.('light');
  } catch (_) {}
}

export function openSchoolCalc(): void {
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Калькулятор школа';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
        <div class="empty" style="text-align:left;padding:0 0 12px;line-height:1.45">
          Формула:<br><b>цена − 70% цены + 30% от цены + 3600 + 3490</b>
        </div>
        <div class="field">
          <label>Цена телефона, ₽</label>
          <input type="number" id="schoolPrice" placeholder="29990" inputmode="decimal">
        </div>
        <button type="button" class="btn-main" onclick="runSchoolCalc()">Посчитать</button>
        <div id="schoolOut" style="display:none" class="combo-result"></div>
      `;
  }
  try {
    if (typeof openModal === 'function') openModal();
    else document.getElementById('overlay')?.classList.add('show');
  } catch (e) {
    console.error(e);
    document.getElementById('overlay')?.classList.add('show');
  }
  setTimeout(() => (document.getElementById('schoolPrice') as HTMLInputElement | null)?.focus(), 200);
}

export function runSchoolCalc(): void {
  const price = Number((document.getElementById('schoolPrice') as HTMLInputElement | null)?.value) || 0;
  if (price <= 0) {
    toast('Укажи цену', 'err');
    return;
  }
  const afterCut = price - price * 0.7;
  const bonus = price * 0.3;
  const total = Math.round(afterCut + bonus + 3600 + 3490);
  const el = document.getElementById('schoolOut');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `
        <div class="big">${total.toLocaleString('ru-RU')} ₽</div>
        <div class="hint">
          ${price.toLocaleString('ru-RU')} − 70% = ${Math.round(afterCut).toLocaleString('ru-RU')}<br>
          + 30% от цены (${Math.round(bonus).toLocaleString('ru-RU')}) + 3 600 + 3 490
        </div>`;
  try {
    (window as any).tg?.HapticFeedback?.impactOccurred?.('light');
  } catch (_) {}
}

export async function openShiftSession(): Promise<void> {
  try {
    const geo = await geoCoords();
    const data: ShiftOpenResponse = await window.apiClient.openShift(authHeaders(true), geo);
    toast('Смена открыта', 'ok');
    try {
      (window as any).tg?.HapticFeedback?.notificationOccurred?.('success');
    } catch (_) {}
    showShiftBrief(data);
    loadMyPlan();
  } catch (e: any) {
    toast(e?.message || 'Не удалось открыть смену', 'err');
  }
}

// ===== SHIFT BRIEF (18.7) =====
// Фаза «до»: план на сегодня + передача от предыдущей смены на этой точке
// (если есть) + незакрытые задачи сотрудника — вместо того чтобы всё это
// узнавать только постфактум при закрытии.
function showShiftBrief(data: ShiftOpenResponse): void {
  const plan: any = data.day_plan || {};
  const handover = data.handover;
  const tasksList = data.open_tasks || [];
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Смена открыта';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
        <div class="progress-block" style="margin-bottom:12px;text-align:left">
          <div class="section-title" style="margin-bottom:8px">План на сегодня</div>
          ${['sim', 'mnp', 'pa', 'combo'].map((m) => progressHTML(metricLabel(m), 0, plan[m])).join('')}
        </div>
        ${
          handover
            ? `
          <div class="progress-block" style="margin-bottom:12px;text-align:left">
            <div class="section-title" style="margin-bottom:8px">Передача от предыдущей смены</div>
            <div style="font-size:13px;line-height:1.5">${esc(handover.handover_note)}</div>
            <div style="font-size:12px;color:var(--hint);margin-top:6px">${esc(handover.from_employee_name || '')}${handover.closed_at ? ' · ' + (timeMoscow(handover.closed_at) || '') : ''}</div>
          </div>`
            : ''
        }
        ${
          tasksList.length
            ? `
          <div class="progress-block" style="text-align:left">
            <div class="section-title" style="margin-bottom:8px">Открытые задачи (${tasksList.length})</div>
            ${tasksList.map((t) => `<div style="font-size:13px;margin-top:4px">• ${esc(t.title)}</div>`).join('')}
          </div>`
            : ''
        }
        <button class="btn-main" style="margin-top:14px" onclick="closeModal()">Понятно</button>
      `;
  }
  if (typeof openModal === 'function') openModal();
  else document.getElementById('overlay')?.classList.add('show');
}

export async function closeShiftSession(): Promise<void> {
  // prompt() в Telegram WebView часто не работает — своя модалка
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Закрыть смену';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
        <div class="field"><label>Самоотчёт (что зашло / что мешало)</label>
          <textarea id="closeReport" rows="3" placeholder="Кратко…"></textarea></div>
        <div class="field"><label>Настроение 1–5</label>
          <input type="number" id="closeMood" min="1" max="5" value="4"></div>
        <div class="field"><label>Заметка для следующей смены (необязательно)</label>
          <textarea id="closeHandover" rows="2" placeholder="Что важно знать тому, кто откроет смену следующим на этой точке…"></textarea></div>
        <button type="button" class="btn-main" style="background:#e74c3c" onclick="confirmCloseShift()">Закрыть смену</button>
      `;
  }
  openModal();
}

export async function confirmCloseShift(): Promise<void> {
  const report = (document.getElementById('closeReport') as HTMLTextAreaElement | null)?.value || '';
  const mood = Math.min(5, Math.max(1, Number((document.getElementById('closeMood') as HTMLInputElement | null)?.value) || 4));
  const handoverNote = (document.getElementById('closeHandover') as HTMLTextAreaElement | null)?.value || '';
  try {
    const geo = await geoCoords();
    const data: ShiftCloseResponse = await window.apiClient.closeShift(authHeaders(true), { ...geo, self_report: report, mood, handover_note: handoverNote });
    try {
      (window as any).tg?.HapticFeedback?.notificationOccurred?.('success');
    } catch (_) {}
    if (data.ideal_shift || (data.plan_pct ?? 0) >= 100) {
      try {
        confettiBurst && confettiBurst();
      } catch (_) {}
    }
    showShiftResult(data);
    if (typeof loadMyPlan === 'function') loadMyPlan();
  } catch (e: any) {
    toast(e?.message || 'Не удалось закрыть смену', 'err');
  }
}

// ===== SHIFT RESULT (14.6) =====
// Разбор смены вместо голой галочки "идеальная / не идеальная": факт/план
// по метрикам, чего не хватило, XP и уровень за эту смену.
function showShiftResult(data: ShiftCloseResponse): void {
  const fact: any = data.fact || {};
  const plan: any = data.day_plan || {};
  const gam: any = data.gamification || {};
  const missing = data.ideal_missing || [];

  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) {
    modalTitle.innerHTML = data.ideal_shift
      ? '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /> </svg> Идеальная смена'
      : 'Смена закрыта';
  }
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
        <div style="text-align:center;padding:4px 0 16px">
          <div style="font-size:36px;font-weight:800;line-height:1">${data.score ?? 0}</div>
          <div style="font-size:12px;color:var(--hint);margin-top:2px">итоговый score</div>
        </div>
        ${['sim', 'mnp', 'pa', 'combo'].map((m) => progressHTML(metricLabel(m), fact[m], plan[m])).join('')}
        ${
          !data.ideal_shift && missing.length
            ? `
          <div class="empty" style="text-align:left;padding:10px 0 0;font-size:12px">
            До идеальной смены: ${esc(missing.join(', '))}
          </div>`
            : ''
        }
        ${
          data.ai_summary
            ? `
          <div class="progress-block" style="margin-top:14px;text-align:left;font-size:13px;line-height:1.5">
            ${esc(data.ai_summary).replace(/\n/g, '<br>')}
          </div>`
            : ''
        }
        <div class="progress-block" style="margin-top:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div>
              <div style="font-weight:700">${esc(gam.title || '')} · ур. ${gam.level || 1}</div>
              <div style="font-size:12px;color:var(--hint)">${gam.xp || 0} XP${gam.next_level_xp != null ? ' / ' + gam.next_level_xp : ''}${gam.leveled_up ? ' · <svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M5.8 11.3 2 22l10.7-3.79" /> <path d="M4 3h.01" /> <path d="M22 8h.01" /> <path d="M15 2h.01" /> <path d="M22 20h.01" /> <path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10" /> <path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17" /> <path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7" /> <path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z" /> </svg> новый уровень!' : ''}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-weight:700;color:var(--success)">+${gam.xp_gained || 0} XP</div>
              ${gam.streak_days ? `<div style="font-size:12px;color:var(--hint)"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" /> </svg> ${gam.streak_days} дн.</div>` : ''}
            </div>
          </div>
          ${data.rewarded === false ? `<div style="font-size:12px;color:var(--hint);margin-top:8px">Смена на эту дату уже была закрыта и награждена сегодня — XP не начисляется повторно</div>` : ''}
        </div>
        <button class="btn-main" style="margin-top:14px" onclick="closeModal()">Понятно</button>
      `;
  }
  if (typeof openModal === 'function') openModal();
  else document.getElementById('overlay')?.classList.add('show');
}

export async function loadShiftAndInsight(empId: number): Promise<void> {
  const shiftEl = document.getElementById('lkShift');
  const insightEl = document.getElementById('lkInsight');
  const gamEl = document.getElementById('lkGamification');
  if (shiftEl) shiftEl.innerHTML = '';
  if (insightEl) insightEl.innerHTML = '';
  if (gamEl) gamEl.innerHTML = '';

  try {
    const [cur, ins, self]: [ShiftCurrentResponse, MyInsightResponse, SelfStatsResponse] = await Promise.all([
      window.apiClient.getShiftCurrent(authHeaders()).catch(() => ({}) as ShiftCurrentResponse),
      window.apiClient.getMyInsight(authHeaders()).catch(() => ({}) as MyInsightResponse),
      window.apiClient.getSelfStats(authHeaders()).catch(() => ({}) as SelfStatsResponse)
    ]);

    if (shiftEl) {
      const sess = cur.session;
      if (sess) {
        const liveFact: any = cur.fact || {};
        const livePlan: any = cur.day_plan || {};
        shiftEl.innerHTML = `
              <div class="progress-block" style="margin-bottom:12px">
                <div class="section-title" style="margin-bottom:8px">Смена открыта</div>
                <div style="font-size:13px;color:var(--hint);margin-bottom:10px">
                  ${esc((sess as any).store_name || (sess as any).store_id || '')} · с ${timeMoscow((sess as any).opened_at) || '—'} МСК
                </div>
                ${['sim', 'mnp', 'pa', 'combo'].map((m) => progressHTML(metricLabel(m), liveFact[m], livePlan[m])).join('')}
                <button class="btn-main" style="background:#e74c3c;margin-top:10px" onclick="closeShiftSession()">Закрыть смену</button>
              </div>`;
      } else {
        shiftEl.innerHTML = `
              <div class="progress-block" style="margin-bottom:12px">
                <div class="section-title" style="margin-bottom:8px">Смена</div>
                <div style="font-size:13px;color:var(--hint);margin-bottom:10px">Открой смену на точке — зафиксируем время и гео</div>
                <button class="btn-main" onclick="openShiftSession()">Открыть смену</button>
              </div>`;
      }
    }

    if (insightEl && ins.insight) {
      const i: any = ins.insight;
      const focus = (i.focus || []).map((f: string) => `<div style="font-size:12px;margin-top:4px">• ${esc(f)}</div>`).join('');
      const split = i.split;
      let splitHtml = '';
      if (split?.before_lunch && split?.after_lunch) {
        splitHtml = `<div style="margin-top:10px;font-size:12px;color:var(--hint)">
              До 15:00: SIM ${split.before_lunch.sim || 0} · MNP ${split.before_lunch.mnp || 0}<br>
              После: SIM ${split.after_lunch.sim || 0} · MNP ${split.after_lunch.mnp || 0}
            </div>`;
      }
      // Predict (21.0) — прогноз итога дня по текущему темпу; null, если ещё
      // слишком рано в смене (see core/analytics/insights.ts).
      let projectionHtml = '';
      if (i.projected_total != null) {
        const color = i.on_track ? 'var(--hint)' : '#e74c3c';
        const verdict = i.on_track ? '' : ' — вероятно, не хватит';
        projectionHtml = `<div style="margin-top:10px;font-size:12px;color:${color}">
              При текущем темпе к концу дня: ~${i.projected_total} (план ${i.plan_total || 0})${verdict}
            </div>`;
      }
      insightEl.innerHTML = `
            <div class="progress-block" style="margin-bottom:12px">
              <div class="section-title" style="margin-bottom:8px">Фокус сейчас</div>
              <div style="font-size:14px;line-height:1.4">${esc(i.message || '')}</div>
              ${focus}${splitHtml}${projectionHtml}
            </div>`;
    }

    if (gamEl && self.gamification) {
      const g: any = self.gamification;
      const best = self.best_shift;
      gamEl.innerHTML = `
            <div class="progress-block" style="margin-bottom:12px">
              <div class="section-title" style="margin-bottom:8px">Прогресс</div>
              <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:13px">
                <div class="lk-pill">lvl <strong>${g.level || 1}</strong> ${g.title || ''}</div>
                <div class="lk-pill">XP <strong>${g.xp || 0}</strong>${g.next_level_xp != null ? ' / ' + g.next_level_xp : ''}</div>
                <div class="lk-pill"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" /> </svg> <strong>${g.streak_days || 0}</strong> дн.</div>
              </div>
              ${best ? `<div style="margin-top:8px;font-size:12px;color:var(--hint)">Лучшая смена: ${best.date} · score ${best.score}</div>` : ''}
            </div>`;
    }
  } catch (e) {
    console.error('shift/insight', e);
  }
}

let quickSaleClientId = '';

export async function openQuickSale(): Promise<void> {
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Быстрый ввод';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
        <div class="empty" style="text-align:left;padding:0 0 12px">
          Пример: <b>две симки и одно mnp</b> · <b>3 sim 1 па</b>
        </div>
        <div class="field">
          <label>Фраза</label>
          <input id="quickSaleText" placeholder="две симки одно mnp" />
        </div>
        <div id="quickSalePreview" class="empty" style="display:none;text-align:left"></div>
        <button class="btn-main" id="quickSaleSubmitBtn" onclick="submitQuickSale()">Разобрать и записать</button>
        <button class="btn-ghost" style="margin-top:8px;width:100%" onclick="previewQuickSale()">Только разобрать</button>
      `;
  }
  // Один client_id на сессию формы — та же защита от двойного тапа/сетевого
  // ретрая, что и в обычном добавлении продажи (features/add-sale).
  quickSaleClientId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
  try {
    if (typeof openModal === 'function') openModal();
    else document.getElementById('overlay')?.classList.add('show');
  } catch (_) {
    document.getElementById('overlay')?.classList.add('show');
  }
  setTimeout(() => (document.getElementById('quickSaleText') as HTMLInputElement | null)?.focus(), 200);
}

export async function previewQuickSale(): Promise<void> {
  const text = (document.getElementById('quickSaleText') as HTMLInputElement | null)?.value || '';
  const data = await window.apiClient.parseSalePhrase(authHeaders(true), { text });
  const el = document.getElementById('quickSalePreview');
  if (!el) return;
  el.style.display = 'block';
  const m: any = data.metrics || {};
  const keys = Object.keys(m);
  el.textContent = keys.length ? keys.map((k) => k + ': ' + m[k]).join(', ') + ' · confidence ' + Math.round((data.confidence || 0) * 100) + '%' : 'Не разобрано';
}

export async function submitQuickSale(): Promise<void> {
  const btn = document.getElementById('quickSaleSubmitBtn') as HTMLButtonElement | null;
  if (btn?.disabled) return;
  const text = (document.getElementById('quickSaleText') as HTMLInputElement | null)?.value || '';
  if (!text.trim()) {
    toast('Введи фразу', 'err');
    return;
  }
  if (btn) btn.disabled = true;
  try {
    const data = await window.apiClient.quickSale(authHeaders(true), { text, client_id: quickSaleClientId });
    closeModal();
    const m: any = data.parsed?.metrics || {};
    toast('Записано: ' + Object.keys(m).map((k) => k + ' ' + m[k]).join(', '), 'ok');
    loadPage(page);
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    if (btn) btn.disabled = false;
  }
}

export async function loadLiveMap(): Promise<void> {
  const box = document.getElementById('liveList');
  const meta = document.getElementById('liveMeta');
  if (box) box.innerHTML = '<div class="skeleton"></div>';
  try {
    const data: NetworkLiveResponse = await window.apiClient.getNetworkLive(authHeaders(), orgQueryParam());
    if (meta) meta.textContent = 'Дата: ' + (data.date || todayMoscow()) + ' · обновление при открытии экрана';
    const stores = data.stores || [];
    if (!stores.length) {
      if (box) box.innerHTML = '<div class="empty">Нет точек</div>';
      return;
    }
    if (box) {
      box.innerHTML = stores
        .map((st) => {
          const statusColor = st.status === 'critical' ? '#e74c3c' : st.status === 'warn' ? '#f39c12' : '#2ecc71';
          const staff = (st.staff || []).map((s) => esc(s.short_name || s.full_name || s.employee_id || '')).join(', ') || 'никого';
          const cash = st.cash ? `Касса Δ ${st.cash.delta}` : 'Касса —';
          return `
            <div class="progress-block" style="margin-bottom:10px;border-left:4px solid ${st.color || statusColor};cursor:pointer"
              onclick="openStoreProfile('${st.store_id}')">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <strong>${esc(st.name)}</strong>
                <span style="color:${statusColor};font-weight:700">${st.plan_pct || 0}%</span>
              </div>
              <div style="font-size:12px;color:var(--hint);margin-top:4px">
                ${staff}<br>
                SIM ${st.fact?.sim || 0}/${st.plan?.sim || 0} · MNP ${st.fact?.mnp || 0}/${st.plan?.mnp || 0}<br>
                ${cash}
              </div>
            </div>`;
        })
        .join('');
    }
  } catch (e) {
    console.error(e);
    if (box) box.innerHTML = '<div class="empty">🍉 Живая карта сети сейчас недоступна, зайди чуть позже</div>';
  }
}

export function confettiBurst(): void {
  // лёгкий confetti без библиотек
  const colors = ['#6d9eeb', '#ff6d01', '#ffd966', '#2ecc71', '#e74c3c'];
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;top:-10px;left:${Math.random() * 100}%;width:8px;height:8px;background:${colors[i % colors.length]};border-radius:2px;z-index:9999;pointer-events:none;animation:t2fall ${1 + Math.random()}s linear forwards`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }
}

// CSS fall
(function () {
  if (document.getElementById('t2-v13-style')) return;
  const s = document.createElement('style');
  s.id = 't2-v13-style';
  s.textContent = '@keyframes t2fall{to{transform:translateY(100vh) rotate(360deg);opacity:0}}';
  document.head.appendChild(s);
})();

declare global {
  interface Window {
    openComboCalc: typeof openComboCalc;
    runComboCalc: typeof runComboCalc;
    openSchoolCalc: typeof openSchoolCalc;
    runSchoolCalc: typeof runSchoolCalc;
    openShiftSession: typeof openShiftSession;
    closeShiftSession: typeof closeShiftSession;
    confirmCloseShift: typeof confirmCloseShift;
    loadShiftAndInsight: typeof loadShiftAndInsight;
    openQuickSale: typeof openQuickSale;
    previewQuickSale: typeof previewQuickSale;
    submitQuickSale: typeof submitQuickSale;
    loadLiveMap: typeof loadLiveMap;
    confettiBurst: typeof confettiBurst;
  }
}
window.openComboCalc = openComboCalc;
window.runComboCalc = runComboCalc;
window.openSchoolCalc = openSchoolCalc;
window.runSchoolCalc = runSchoolCalc;
window.openShiftSession = openShiftSession;
window.closeShiftSession = closeShiftSession;
window.confirmCloseShift = confirmCloseShift;
window.loadShiftAndInsight = loadShiftAndInsight;
window.openQuickSale = openQuickSale;
window.previewQuickSale = previewQuickSale;
window.submitQuickSale = submitQuickSale;
window.loadLiveMap = loadLiveMap;
window.confettiBurst = confettiBurst;
