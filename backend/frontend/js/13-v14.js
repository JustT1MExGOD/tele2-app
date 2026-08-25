/* 13-v14.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== V14 =====
    async function applyBranding() {
      try {
        const b = await window.apiClient.getBranding(authHeaders());
        if (b.primary_color) document.documentElement.style.setProperty('--primary', b.primary_color);
        if (b.app_title) document.title = b.app_title;
        window.__brand = b;
      } catch (_) {}
    }
    async function fillStoreSelects() {
      let list = window.__stores || [];
      if (!list.length) {
        list = await fetchOrgStores();
        window.__stores = list;
      }
      if (!list.length) {
        list = [
          { id: 'kosmonavtov', name: 'Космонавтов 20А' },
          { id: 'kalinina2', name: 'Калинина 2' },
          { id: 'kalinina11', name: 'Калинина 11' }
        ];
        window.__stores = list;
      }
      ['hmStore','fcStore','wiFrom','wiTo','riStore','cashStore'].forEach(id => {
        const el = document.getElementById(id);
        if (!el || el.tagName !== 'SELECT') return;
        const cur = el.value;
        el.innerHTML = list.map(s => `<option value="${s.id}">${s.name || s.id}</option>`).join('');
        if (cur && list.some(s => s.id === cur)) el.value = cur;
      });
    }
    async function loadHeatmap() {
      const sid = document.getElementById('hmStore')?.value;
      const meta = document.getElementById('hmMeta');
      const grid = document.getElementById('hmGrid');
      if (!grid) return;
      if (!sid) {
        if (meta) meta.textContent = 'Выбери точку';
        grid.innerHTML = '';
        return;
      }
      grid.innerHTML = '<div class="skeleton"></div>';
      try {
        const data = await window.apiClient.getHeatmapPrecise(authHeaders(), sid, orgQueryParam());
        const hours = data.hours || data.by_hour || [];
        // hours: [{hour, value}] or map
        let cells = [];
        if (Array.isArray(hours) && hours.length) {
          cells = hours;
        } else if (data.profile && typeof data.profile === 'object') {
          cells = Object.keys(data.profile).map(h => ({ hour: Number(h), value: Number(data.profile[h]) || 0 }));
        } else if (Array.isArray(data.rows)) {
          cells = data.rows;
        }
        // только рабочие часы 9–21
        cells = (cells || []).map(c => ({
          hour: Number(c.hour ?? c.sale_hour),
          value: Number(c.value || c.count || c.total || 0)
        })).filter(c => c.hour >= 9 && c.hour <= 21);
        if (!cells.length) {
          for (let h = 9; h <= 21; h++) cells.push({ hour: h, value: 0 });
        } else {
          // заполнить пропуски нулями
          const map = new Map(cells.map(c => [c.hour, c.value]));
          cells = [];
          for (let h = 9; h <= 21; h++) cells.push({ hour: h, value: map.get(h) || 0 });
        }
        const max = Math.max(1, ...cells.map(c => c.value));
        let best = cells[0];
        for (const c of cells) if (c.value > best.value) best = c;
        if (meta) {
          meta.innerHTML = (data.note || 'Heatmap по часу продажи (МСК)') +
            ' · 9:00–21:00' +
            (best.value > 0
              ? ` · <b style="color:var(--primary)">лучший час ${best.hour}:00</b> (${best.value})`
              : ' · пока нет пиков');
        }
        grid.innerHTML = `<div class="hm-grid">
          ${cells.map(c => {
            const intensity = c.value / max;
            const isBest = best.value > 0 && c.hour === best.hour;
            const bg = isBest ? '' : `background:rgba(42,171,238,${0.12 + intensity * 0.75})`;
            return `<div class="hm-cell${isBest ? ' best' : ''}" style="${bg}">
              <div class="h">${c.hour}:00</div>
              <div class="v">${c.value}</div>
            </div>`;
          }).join('')}
        </div>`;
      } catch (e) {
        if (meta) meta.textContent = '';
        grid.innerHTML = `<div class="empty">🍉 Пока нечего показать — как только по точке пойдут продажи, здесь появится картина по часам</div>`;
      }
    }

    async function loadForecast() {
      await fillStoreSelects();
      const sid = document.getElementById('fcStore')?.value;
      const box = document.getElementById('fcList');
      if (!sid||!box) return;
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const data = await window.apiClient.getForecast(authHeaders(), sid, orgQueryParam());
        const histDays = Number(data.history_days) || 0;
        const note = histDays < 14
          ? `<div class="empty" style="padding:0 0 10px;text-align:left">🍉 Пока только ${histDays} дн. истории — прогноз грубый, будет точнее по мере накопления данных</div>`
          : '';
        const items = data.items || [];
        const totals = items.map(it => {
          const p = it.predicted || {};
          return (Number(p.sim)||0) + (Number(p.mnp)||0) + (Number(p.pa)||0) + (Number(p.combo)||0);
        });
        const totalMax = Math.max(1, ...totals);
        const trendBars = items.length ? `
          <div class="progress-block" style="margin-bottom:12px">
            <div class="section-title" style="margin-bottom:8px">Форма недели, юниты в день</div>
            <div style="display:flex;align-items:flex-end;gap:2px;height:50px">
              ${items.map((it, i) => `
                <div style="flex:1;background:var(--primary-soft);border-radius:2px 2px 0 0;height:${Math.max(4, Math.round(totals[i] / totalMax * 100))}%" title="${it.date}: ${totals[i]}"></div>
              `).join('')}
            </div>
          </div>` : '';
        const aiBlock = data.ai_summary ? `
          <div class="progress-block" style="margin-bottom:12px;text-align:left;font-size:13px;line-height:1.5">
            <svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 8V4H8" /> <rect width="16" height="12" x="4" y="8" rx="2" /> <path d="M2 14h2" /> <path d="M20 14h2" /> <path d="M15 13v2" /> <path d="M9 13v2" /> </svg> ${esc(data.ai_summary)}
          </div>` : '';
        const cards = items.map(it => {
          const p = it.predicted||{};
          const n = (v) => Math.round(Number(v) || 0);
          return `<div class="mt-card"><div class="mt-name">${it.date}</div><div class="mt-grid mt-grid-4">
            <div class="mt-cell"><div class="v">${n(p.sim)}</div><div class="l">SIM</div></div>
            <div class="mt-cell"><div class="v">${n(p.mnp)}</div><div class="l">MNP</div></div>
            <div class="mt-cell"><div class="v">${n(p.pa)}</div><div class="l">ПА</div></div>
            <div class="mt-cell"><div class="v">${n(p.combo)}</div><div class="l">Комбо</div></div>
          </div></div>`;
        }).join('');
        box.innerHTML = cards ? (note + trendBars + aiBlock + cards) : '<div class="empty">🍉 Пока нет истории для прогноза по этой точке</div>';
      } catch { box.innerHTML = '<div class="empty">🍉 Прогноз сейчас недоступен, зайди чуть позже</div>'; }
    }

    // «Кого куда поставить» — эвристика на прогнозе + графике (15.7), manager/admin only.
    async function loadStaffingHints() {
      const section = document.getElementById('staffHintsSection');
      const box = document.getElementById('staffHintsList');
      if (!section || !box) return;
      if (!canManage()) { section.style.display = 'none'; return; }
      try {
        const data = await window.apiClient.getStaffingHints(authHeaders(), orgQueryParam());
        const items = data.items || [];
        if (!items.length) {
          section.style.display = '';
          box.innerHTML = '<div class="empty">🍉 На неделю вперёд перекосов не видно — график и прогноз сходятся</div>';
          return;
        }
        section.style.display = '';
        box.innerHTML = items.map(h => `
          <div class="sv-drop ${h.severity === 'critical' ? '' : 'warn'}" style="margin:8px 0 0">
            <div class="ico">${h.severity === 'critical' ? '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M7 18v-6a5 5 0 1 1 10 0v6" /> <path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z" /> <path d="M21 12h1" /> <path d="M18.5 4.5 18 5" /> <path d="M2 12h1" /> <path d="M12 2v1" /> <path d="m4.929 4.929.707.707" /> <path d="M12 12v6" /> </svg>' : '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" /> </svg>'}</div>
            <div style="flex:1">
              <div class="t">${esc(h.store_name)} · ${h.date}</div>
              <div class="s">${esc(h.message)}</div>
              <button class="mchip" style="margin-top:6px" onclick="proposeMoveForStore('${h.store_id}','${h.date}')">Предложить перенос</button>
            </div>
          </div>`).join('');
      } catch {
        section.style.display = 'none';
      }
    }

    // ===== WHAT-IF v2 (14.8) =====
    // Сценарий — накапливаемый список переносов вместо одного за раз, плюс
    // сравнение двух посчитанных сценариев (A/B) side-by-side. Симуляция
    // (simulateScheduleMoves) уже принимала массив moves — это чисто
    // фронтенд-надстройка над тем, что бэкенд умел давно.
    window.__wiMoves = window.__wiMoves || [];

    // «Действие из просадки»: кнопка на карточке просадки (Command Center /
    // кабинет супервайзера) ведёт прямо в What-if с уже выбранной точкой-
    // получателем — не нужно с нуля собирать сценарий, только выбрать
    // сотрудника и «откуда».
    async function proposeMoveForStore(storeId, date) {
      switchPage('forecast');
      await fillStoreSelects();
      const wiTo = document.getElementById('wiTo');
      if (wiTo) wiTo.value = storeId;
      const wiDate = document.getElementById('wiDate');
      if (wiDate) wiDate.value = date || todayMoscow();
      const storeName = (window.__stores || stores || []).find(s => s.id === storeId)?.name || storeId;
      const dateLabel = date && date !== todayMoscow() ? ` на ${date}` : '';
      toast(`Точка выбрана: ${storeName}${dateLabel} — укажи сотрудника и «с точки»`, 'ok');
      setTimeout(() => {
        document.getElementById('wiEmp')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
    window.proposeMoveForStore = proposeMoveForStore;

    function renderWiMovesList() {
      const box = document.getElementById('wiMovesList');
      if (!box) return;
      const moves = window.__wiMoves;
      if (!moves.length) { box.innerHTML = ''; return; }
      box.innerHTML = moves.map((m, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface-2);border-radius:10px;margin-bottom:6px;font-size:12px">
          <div style="flex:1">#${m.employee_id}: ${m.from_store || 'авто'} → ${m.to_store}</div>
          <button type="button" style="background:none;border:none;color:var(--danger,#ff3b30);font-size:16px;line-height:1;cursor:pointer" onclick="removeWiMove(${i})">×</button>
        </div>`).join('');
    }

    function addWiMove() {
      const emp = Number(document.getElementById('wiEmp')?.value);
      const to = document.getElementById('wiTo')?.value;
      const from = document.getElementById('wiFrom')?.value || null;
      if (!emp || !to) { toast('Укажи сотрудника и точку назначения', 'err'); return; }
      window.__wiMoves.push({ employee_id: emp, from_store: from, to_store: to });
      renderWiMovesList();
      const empInput = document.getElementById('wiEmp');
      if (empInput) empInput.value = '';
    }

    function removeWiMove(idx) {
      window.__wiMoves.splice(idx, 1);
      renderWiMovesList();
    }

    function clearWiMoves() {
      window.__wiMoves = [];
      renderWiMovesList();
    }

    function renderWiScenario(data, date) {
      const rows = (data.stores || []).map(s => {
        const d = Number(s.delta_sim) || 0;
        const col = d > 0 ? '#34c759' : d < 0 ? '#ff3b30' : 'var(--hint)';
        return `<div class="progress-block" style="margin:8px 0;padding:12px;border-left:4px solid ${s.color || '#2AABEE'}">
          <div style="font-weight:700">${s.name}</div>
          <div style="font-size:12px;color:var(--hint);margin:4px 0">Сотрудников: ${s.staff_before} → <b>${s.staff_after}</b></div>
          <div style="font-size:13px">SIM ожид. <b>${s.expected?.sim ?? 0}</b> → <b>${s.after?.sim ?? 0}</b>
            <span style="color:${col};font-weight:700"> (${d > 0 ? '+' : ''}${d})</span></div>
          <div style="font-size:12px;color:var(--hint)">MNP ${s.expected?.mnp ?? 0}→${s.after?.mnp ?? 0} · ПА ${s.expected?.pa ?? 0}→${s.after?.pa ?? 0}</div>
        </div>`;
      }).join('');
      const sum = data.summary || {};
      const canApply = canManage() && (data.moves_applied || []).some(m => !m.skipped);
      // Сумма delta_sim по сети — игра с нулевой суммой (кто-то теряет
      // ровно столько, сколько получает другая точка), сравнивать сценарии
      // по ней бессмысленно. Сравниваем по худшей точке: у какого сценария
      // просадка в самом слабом месте меньше.
      const deltas = (data.stores || []).map((x) => Number(x.delta_sim) || 0);
      const worstDelta = deltas.length ? Math.min(...deltas) : 0;
      const lostCount = (sum.stores_lost || []).length;
      return {
        worstDelta,
        lostCount,
        html: `<div style="font-size:12px;color:var(--hint);margin-bottom:8px">Дата ${data.date || date} · ${(data.moves_applied || []).filter(m => !m.skipped).length} перенос(ов) применено</div>
          ${sum.stores_gained?.length ? `<div style="color:#34c759;font-size:13px;margin-bottom:6px">↑ ${sum.stores_gained.join(', ')}</div>` : ''}
          ${sum.stores_lost?.length ? `<div style="color:#ff3b30;font-size:13px;margin-bottom:6px">↓ ${sum.stores_lost.join(', ')}</div>` : ''}
          ${rows || '<div class="empty">Нет точек</div>'}
          <div style="display:flex;gap:8px;margin-top:12px">
            ${canApply ? `<button class="btn-main" style="flex:1" onclick="applyWhatIf()">Записать в график</button>` : ''}
            <button type="button" class="btn-ghost" style="flex:1" onclick="saveWiScenarioA()">Сохранить как сценарий A</button>
          </div>
          ${canApply ? `<div style="font-size:11px;color:var(--hint);margin-top:6px;text-align:center">Запись в график обновит schedules на эту дату</div>` : ''}`
      };
    }

    async function runWhatIf() {
      const date = document.getElementById('wiDate')?.value || todayMoscow();
      const box = document.getElementById('wiResult');
      if (!box) return;

      let moves = window.__wiMoves.slice();
      // удобство: если сценарий пуст, но поля заполнены — считаем это одним
      // быстрым переносом, не заставляя жать "Добавить" ради единственного шага
      if (!moves.length) {
        const emp = Number(document.getElementById('wiEmp')?.value);
        const to = document.getElementById('wiTo')?.value;
        const from = document.getElementById('wiFrom')?.value || null;
        if (emp && to) moves = [{ employee_id: emp, from_store: from, to_store: to }];
      }
      if (!moves.length) { box.innerHTML = '<div class="empty">Добавь хотя бы один перенос в сценарий</div>'; return; }

      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const wiBody = { date, moves };
        if (me?.role === 'admin' && adminViewOrgId) wiBody.org_id = adminViewOrgId;
        const data = await window.apiClient.runWhatIf(authHeaders(true), wiBody);
        window.__lastWhatIf = { date: data.date || date, moves, org_id: wiBody.org_id };
        window.__wiLastResult = { data, date: data.date || date, moves };
        const scenario = renderWiScenario(data, date);
        box.innerHTML = scenario.html;
        if (window.__wiScenarioA) compareWiScenarios();
      } catch (e) {
        box.innerHTML = `<div class="empty">${e.message || e}</div>`;
      }
    }

    function saveWiScenarioA() {
      if (!window.__wiLastResult) { toast('Сначала пересчитай сценарий', 'err'); return; }
      window.__wiScenarioA = window.__wiLastResult;
      document.getElementById('wiCompareBox').innerHTML = `
        <div class="empty" style="text-align:left;padding:10px 0 0;font-size:12px">
          Сценарий A сохранён (${window.__wiScenarioA.moves.length} перенос(ов)). Собери другой набор переносов и пересчитай — появится сравнение с B.
        </div>`;
      toast('Сценарий A сохранён', 'ok');
    }

    function compareWiScenarios() {
      const a = window.__wiScenarioA;
      const b = window.__wiLastResult;
      const box = document.getElementById('wiCompareBox');
      if (!box || !a || !b) return;
      // Перенос внутри сети — игра с нулевой суммой, сравнивать по сумме
      // дельт по всей сети бессмысленно (она ≈0 всегда). Сравниваем по
      // худшей просевшей точке и по числу точек "в минусе".
      const worst = (res) => {
        const deltas = (res.data.stores || []).map((x) => Number(x.delta_sim) || 0);
        return deltas.length ? Math.min(...deltas) : 0;
      };
      const aWorst = worst(a);
      const bWorst = worst(b);
      const aLost = (a.data.summary?.stores_lost || []).length;
      const bLost = (b.data.summary?.stores_lost || []).length;
      const better = bWorst > aWorst ? 'B' : bWorst < aWorst ? 'A' : null;
      box.innerHTML = `
        <div class="section-title" style="margin-top:16px">Сравнение сценариев</div>
        <div style="display:flex;gap:10px">
          <div class="progress-block" style="flex:1;${better === 'A' ? 'border:1px solid #34c759' : ''}">
            <div style="font-weight:700">Сценарий A</div>
            <div style="font-size:12px;color:var(--hint)">${a.moves.length} перенос(ов)</div>
            <div style="font-size:20px;font-weight:800;margin-top:6px">${aWorst > 0 ? '+' : ''}${aWorst}</div>
            <div style="font-size:11px;color:var(--hint)">худшая точка (Δ SIM) · ${aLost} в минусе</div>
          </div>
          <div class="progress-block" style="flex:1;${better === 'B' ? 'border:1px solid #34c759' : ''}">
            <div style="font-weight:700">Сценарий B (текущий)</div>
            <div style="font-size:12px;color:var(--hint)">${b.moves.length} перенос(ов)</div>
            <div style="font-size:20px;font-weight:800;margin-top:6px">${bWorst > 0 ? '+' : ''}${bWorst}</div>
            <div style="font-size:11px;color:var(--hint)">худшая точка (Δ SIM) · ${bLost} в минусе</div>
          </div>
        </div>
        ${better ? `<div class="empty" style="text-align:left;padding:8px 0 0;font-size:12px">Сценарий ${better} меньше проседает в своей самой слабой точке</div>` : '<div class="empty" style="text-align:left;padding:8px 0 0;font-size:12px">Сценарии одинаково влияют на самую слабую точку</div>'}
        <button type="button" class="btn-ghost" style="width:100%;margin-top:8px" onclick="window.__wiScenarioA=null;document.getElementById('wiCompareBox').innerHTML=''">Очистить сравнение</button>`;
    }

    async function applyWhatIf() {
      const payload = window.__lastWhatIf;
      if (!payload?.moves?.length) { toast('Сначала пересчитай what-if', 'err'); return; }
      if (!canManage()) { toast('Только manager', 'err'); return; }
      try {
        const data = await window.apiClient.applyWhatIf(authHeaders(true), payload);
        toast('График обновлён: ' + (data.count || 0) + ' смен', 'ok');
        if (typeof loadMonthSchedule === 'function') loadMonthSchedule();
      } catch (e) {
        toast(e.message || 'Не удалось применить', 'err');
      }
    }

    async function loadAnnouncements() {
      const box = document.getElementById('anList');
      if (!box) return;
      const create = document.getElementById('anCreate');
      if (create) create.style.display = canManage() ? '' : 'none';
      try {
        const data = await window.apiClient.getAnnouncements(authHeaders());
        // бэкенд отдаёт голый массив (как /sales, /employees и т.д.), а не {items:[...]} —
        // раньше тут был data.items||[], который на массиве всегда давал [] и объявления
        // никогда не показывались, сколько бы их ни было в базе
        const items = Array.isArray(data) ? data : (data.items || []);
        if (!items.length) { box.innerHTML = '<div class="empty">🍉 Нет объявлений</div>'; return; }
        box.innerHTML = items.map(a => `<div class="mt-card">
          <div class="mt-name">${esc(a.title||'')} ${a.required?'· обязательно':''}</div>
          <div class="mt-meta">${a.is_read?'<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M20 6 9 17l-5-5" /> </svg> прочитано':'не прочитано'} · ${String(a.created_at||'').slice(0,10)}</div>
          <div style="padding:8px 0;font-size:14px;line-height:1.45">${esc(a.body||'')}</div>
          ${a.is_read?'':`<button class="btn-main" onclick="markAnnouncementRead(${a.id})">Прочитал</button>`}
          ${canManage() ? `<button class="mchip" style="margin-top:8px" onclick="showAnnouncementReads(${a.id})">Кто прочитал</button>` : ''}
        </div>`).join('');
      } catch { box.innerHTML = '<div class="empty">🍉 Не удалось загрузить объявления</div>'; }
    }

    async function showAnnouncementReads(id) {
      document.getElementById('modalTitle').textContent = 'Кто прочитал';
      document.getElementById('modalBody').innerHTML = '<div class="empty">Загрузка…</div>';
      document.getElementById('overlay')?.classList.add('show');
      try {
        const d = await window.apiClient.getAnnouncementReads(authHeaders(), id, '');
        const read = d.read || [];
        const unread = d.unread || [];
        document.getElementById('modalBody').innerHTML = `
          <div class="section-title" style="margin-bottom:8px">Прочитали (${read.length}/${read.length + unread.length})</div>
          <div class="progress-block" style="margin-bottom:12px">
            ${read.length ? read.map(e => `<div style="font-size:13px;padding:4px 0"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M20 6 9 17l-5-5" /> </svg> ${esc(e.full_name)}</div>`).join('') : '<div class="empty" style="padding:4px 0">Пока никто</div>'}
          </div>
          ${unread.length ? `
            <div class="section-title" style="margin-bottom:8px">Ещё не прочитали</div>
            <div class="progress-block">
              ${unread.map(e => `<div style="font-size:13px;padding:4px 0;color:var(--hint)">${esc(e.full_name)}</div>`).join('')}
            </div>` : ''}
        `;
      } catch (e) {
        document.getElementById('modalBody').innerHTML = '<div class="empty">Не удалось загрузить</div>';
      }
    }
    async function markAnnouncementRead(id) {
      await window.apiClient.markAnnouncementRead(authHeaders(true), id).catch(() => {});
      loadAnnouncements();
    }
    async function createAnnouncement() {
      const title = document.getElementById('anTitle')?.value?.trim();
      const body = document.getElementById('anBody')?.value?.trim();
      const required = !!document.getElementById('anReq')?.checked;
      if (!title || !body) { toast('Заполни заголовок и текст', 'err'); return; }
      try {
        await window.apiClient.createAnnouncement(authHeaders(true), { title, body, required });
      } catch (e) {
        toast((e.message || 'Ошибка') + ' (нужна таблица announcements)', 'err');
        return;
      }
      toast('Опубликовано','ok');
      loadAnnouncements();
    }
    async function loadReportSvg() {
      const sid = document.getElementById('riStore')?.value;
      const date = document.getElementById('riDate')?.value || todayMoscow();
      const box = document.getElementById('riPreview');
      if (!box) return;
      if (!sid) {
        box.innerHTML = '<div class="empty">Выбери точку</div>';
        return;
      }
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const data = await window.apiClient.getReportDay(authHeaders(), sid, date, orgQueryParam());
        if (data.svgs) {
          // story: 3 кадра — план → факт → фокус на завтра, как реально уйдёт в чат
          const frames = [
            ['План', data.svgs.plan],
            ['Факт', data.svgs.fact],
            ['Завтра', data.svgs.tomorrow]
          ];
          box.innerHTML = frames.map(([label, svg]) => `
            <div style="margin-bottom:12px">
              <div style="font-size:12px;color:var(--hint);margin-bottom:6px;padding-left:2px">${label}</div>
              <div style="border-radius:16px;overflow:hidden;background:#0A0A0B">${svg}</div>
            </div>`).join('');
          return;
        }
        if (!data.svg) throw new Error('Пустой svg в ответе');
        // SVG inline
        box.innerHTML = '<div style="border-radius:16px;overflow:hidden;background:#0A0A0B">' + data.svg + '</div>';
      } catch (e) {
        console.error('loadReportSvg', e);
        box.innerHTML = '<div class="empty">Не удалось сгенерировать<br><span style="font-size:12px;opacity:.75">' +
          (e.message || e) +
          '</span><br><span style="font-size:11px;opacity:.6">Проверь: V14 routes, X-Telegram-Id, точка</span></div>';
      }
    }

    // ===== СЕТИ (admin) — создание/редактирование organizations без SQL =====
    let orgsAdminCache = []; // последний ответ GET /orgs — открываем форму
                              // редактирования без второго запроса, все поля уже тут

    async function loadOrgsAdmin() {
      const box = document.getElementById('orgsList');
      if (!box) return;
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const orgs = await window.apiClient.getOrgsAdmin(authHeaders());
        orgsAdminCache = Array.isArray(orgs) ? orgs : [];
        box.innerHTML = orgsAdminCache.map(o => `
          <button class="row" onclick="openEditOrg('${o.id}')">
            <div class="row-icon">${o.is_active === false ? '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <circle cx="12" cy="12" r="10" /> <path d="M4.929 4.929 19.07 19.071" /> </svg>' : '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <circle cx="12" cy="12" r="10" /> <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /> <path d="M2 12h20" /> </svg>'}</div>
            <div class="row-body">
              <div class="row-title">${esc(o.name)}${o.is_active === false ? ' · выключена' : ''}</div>
              <div class="row-sub">${esc(o.id)} · сектор ${esc(o.sector_id || 'default')}${o.dealer_name ? ' · дилер ' + esc(o.dealer_name) : ''}${o.chat_id ? ' · чат подключён' : ' · чат не настроен'}</div>
            </div>
            <div class="row-chevron">›</div>
          </button>`).join('') || '<div class="empty">🍉 Сетей пока нет</div>';
      } catch {
        box.innerHTML = '<div class="empty">🍉 Не получилось загрузить сети</div>';
      }
    }

    const AUDIT_ACTION_LABEL = {
      'employee.role_change': 'Смена роли',
      'employee.deactivate': 'Изменение статуса сотрудника',
      'sales.correction': 'Правка продажи',
      'plan.update': 'Изменение плана',
      'export.csv': 'Экспорт CSV'
    };

    function auditDiffHTML(item) {
      const before = item.before ? JSON.stringify(item.before) : null;
      const after = item.after ? JSON.stringify(item.after) : null;
      if (before && after) return `${esc(before)} → ${esc(after)}`;
      if (after) return esc(after);
      return '';
    }

    async function loadAuditLog() {
      const box = document.getElementById('auditList');
      if (!box) return;
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const data = await window.apiClient.getAuditLog(authHeaders(), orgQueryParam());
        const items = Array.isArray(data.items) ? data.items : [];
        box.innerHTML = items.map(item => `
          <div class="row" style="cursor:default">
            <div class="row-body">
              <div class="row-title">${esc(AUDIT_ACTION_LABEL[item.action] || item.action)}</div>
              <div class="row-sub">${esc(item.actor_name || 'Система')} · ${esc(item.target_type)}${item.target_id ? ' #' + esc(item.target_id) : ''}</div>
              <div class="row-sub" style="font-family:ui-monospace,monospace;font-size:11px">${auditDiffHTML(item)}</div>
            </div>
            <div class="row-sub">${new Date(item.created_at).toLocaleString('ru')}</div>
          </div>`).join('') || '<div class="empty">🍉 Действий пока нет</div>';
      } catch {
        box.innerHTML = '<div class="empty">🍉 Не получилось загрузить историю</div>';
      }
    }

    function orgFormHTML(o) {
      o = o || {};
      return `
        <div class="field"><label>ID (латиница${o.id ? ', нельзя изменить' : ''})</label>
          <input id="no_id" placeholder="novaya_set" value="${esc(o.id || '')}" ${o.id ? 'disabled' : ''}></div>
        <div class="field"><label>Название</label><input id="no_name" value="${esc(o.name || '')}"></div>
        <div class="field"><label>Бренд (короткое имя)</label><input id="no_brand" value="${esc(o.brand_name || '')}"></div>
        <div class="field"><label>Основной цвет</label><input id="no_color" value="${esc(o.primary_color || '#2AABEE')}"></div>
        <div class="field"><label>Сектор</label><input id="no_sector" value="${esc(o.sector_id || 'default')}"></div>
        <div class="field"><label>Дилер (владелец сектора)</label><input id="no_dealer" placeholder="ООО «Ромашка»" value="${esc(o.dealer_name || '')}"></div>
        <div class="field"><label>Chat ID группы</label><input id="no_chat" placeholder="-100…" value="${esc(o.chat_id || '')}"></div>
        <div class="field"><label>Thread ID · продажи</label><input id="no_sales_thread" placeholder="необязательно" value="${esc(o.sales_thread_id || '')}"></div>
        <div class="field"><label>Thread ID · отчёты</label><input id="no_reports_thread" placeholder="необязательно" value="${esc(o.reports_thread_id || '')}"></div>
        <div class="empty" style="text-align:left;padding:4px 0;font-size:12px">Chat ID и Thread ID узнать командой /chatid в нужной группе/теме Telegram — бот пришлёт оба числа в ответ.</div>
        ${o.id ? `<div class="field" style="display:flex;align-items:center;gap:8px">
          <input id="no_active" type="checkbox" ${o.is_active === false ? '' : 'checked'}>
          <label for="no_active" style="margin:0">Сеть активна</label>
        </div>` : ''}
        <button class="btn-main" onclick="saveOrg('${o.id || ''}')">Сохранить</button>
      `;
    }

    function openAddOrg() {
      if (!canAdmin()) return;
      document.getElementById('modalTitle').textContent = 'Новая сеть';
      document.getElementById('modalBody').innerHTML = orgFormHTML({});
      document.getElementById('overlay').classList.add('show');
    }

    function openEditOrg(id) {
      if (!canAdmin()) return;
      const o = orgsAdminCache.find(x => x.id === id);
      if (!o) { toast('Сеть не найдена', 'err'); return; }
      document.getElementById('modalTitle').textContent = o.name || id;
      document.getElementById('modalBody').innerHTML = orgFormHTML(o);
      document.getElementById('overlay').classList.add('show');
    }

    async function saveOrg(existingId) {
      const id = existingId || document.getElementById('no_id').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const name = document.getElementById('no_name').value.trim();
      if (!id || !name) { toast('ID и название обязательны', 'err'); return; }
      const body = {
        name,
        brand_name: document.getElementById('no_brand').value.trim() || undefined,
        primary_color: document.getElementById('no_color').value.trim() || undefined,
        sector_id: document.getElementById('no_sector').value.trim() || undefined,
        dealer_name: document.getElementById('no_dealer').value.trim() || undefined,
        chat_id: document.getElementById('no_chat').value.trim() || undefined,
        sales_thread_id: document.getElementById('no_sales_thread').value.trim() || undefined,
        reports_thread_id: document.getElementById('no_reports_thread').value.trim() || undefined
      };
      const activeEl = document.getElementById('no_active');
      if (activeEl) body.is_active = activeEl.checked;
      try {
        await window.apiClient.saveOrg(authHeaders(true), id, body);
      } catch (e) {
        toast('Ошибка', 'err');
        return;
      }
      toast(existingId ? 'Сеть обновлена' : 'Сеть создана', 'ok');
      closeModal();
      loadOrgsAdmin();
    }

    console.log('T2 Sales UI v14');

