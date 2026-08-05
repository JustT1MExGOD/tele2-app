/* 13-v14.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== V14 =====
    async function applyBranding() {
      try {
        const res = await fetch(API + '/branding', { headers: authHeaders() });
        if (!res.ok) return;
        const b = await res.json();
        if (b.primary_color) document.documentElement.style.setProperty('--primary', b.primary_color);
        if (b.app_title) document.title = b.app_title;
        window.__brand = b;
      } catch (_) {}
    }
    async function fillStoreSelects() {
      let list = window.__stores || [];
      if (!list.length) {
        try {
          let r = await fetch(API + '/org/stores', { headers: authHeaders() });
          if (r.ok) list = (await r.json()).stores || [];
        } catch (_) {}
        if (!list.length) {
          try {
            const r = await fetch(API + '/stores', { headers: authHeaders() });
            if (r.ok) { const d = await r.json(); list = Array.isArray(d) ? d : (d.stores||[]); }
          } catch (_) {}
        }
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
        const res = await fetch(API + '/heatmap/precise/' + encodeURIComponent(sid) + '?weeks=4', { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error || 'fail');
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
        const res = await fetch(API + '/forecast/' + sid + '?days=7', { headers: authHeaders() });
        const data = await res.json();
        const histDays = Number(data.history_days) || 0;
        const note = histDays < 14
          ? `<div class="empty" style="padding:0 0 10px;text-align:left">🍉 Пока только ${histDays} дн. истории — прогноз грубый, будет точнее по мере накопления данных</div>`
          : '';
        const cards = (data.items||[]).map(it => {
          const p = it.predicted||{};
          const n = (v) => Math.round(Number(v) || 0);
          return `<div class="mt-card"><div class="mt-name">${it.date}</div><div class="mt-grid mt-grid-4">
            <div class="mt-cell"><div class="v">${n(p.sim)}</div><div class="l">SIM</div></div>
            <div class="mt-cell"><div class="v">${n(p.mnp)}</div><div class="l">MNP</div></div>
            <div class="mt-cell"><div class="v">${n(p.pa)}</div><div class="l">ПА</div></div>
            <div class="mt-cell"><div class="v">${n(p.combo)}</div><div class="l">Комбо</div></div>
          </div></div>`;
        }).join('');
        box.innerHTML = cards ? (note + cards) : '<div class="empty">🍉 Пока нет истории для прогноза по этой точке</div>';
      } catch { box.innerHTML = '<div class="empty">🍉 Прогноз сейчас недоступен, зайди чуть позже</div>'; }
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
    async function proposeMoveForStore(storeId) {
      switchPage('forecast');
      await fillStoreSelects();
      const wiTo = document.getElementById('wiTo');
      if (wiTo) wiTo.value = storeId;
      const wiDate = document.getElementById('wiDate');
      if (wiDate && !wiDate.value) wiDate.value = todayMoscow();
      const storeName = (window.__stores || stores || []).find(s => s.id === storeId)?.name || storeId;
      toast(`Точка выбрана: ${storeName} — укажи сотрудника и «с точки»`, 'ok');
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
        const res = await fetch(API + '/schedule/what-if', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({ date, moves })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error || 'fail');
        window.__lastWhatIf = { date: data.date || date, moves };
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
        const res = await fetch(API + '/schedule/what-if/apply', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || 'fail');
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
        const res = await fetch(API + '/announcements', { headers: authHeaders() });
        const data = await res.json();
        // бэкенд отдаёт голый массив (как /sales, /employees и т.д.), а не {items:[...]} —
        // раньше тут был data.items||[], который на массиве всегда давал [] и объявления
        // никогда не показывались, сколько бы их ни было в базе
        const items = Array.isArray(data) ? data : (data.items || []);
        if (!items.length) { box.innerHTML = '<div class="empty">🍉 Нет объявлений</div>'; return; }
        box.innerHTML = items.map(a => `<div class="mt-card">
          <div class="mt-name">${esc(a.title||'')} ${a.required?'· обязательно':''}</div>
          <div class="mt-meta">${a.is_read?'✓ прочитано':'не прочитано'} · ${String(a.created_at||'').slice(0,10)}</div>
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
        const res = await fetch(API + '/announcements/' + id + '/reads', { headers: authHeaders() });
        if (!res.ok) throw new Error('fail');
        const d = await res.json();
        const read = d.read || [];
        const unread = d.unread || [];
        document.getElementById('modalBody').innerHTML = `
          <div class="section-title" style="margin-bottom:8px">Прочитали (${read.length}/${read.length + unread.length})</div>
          <div class="progress-block" style="margin-bottom:12px">
            ${read.length ? read.map(e => `<div style="font-size:13px;padding:4px 0">✓ ${esc(e.full_name)}</div>`).join('') : '<div class="empty" style="padding:4px 0">Пока никто</div>'}
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
      await fetch(API + '/announcements/' + id + '/read', { method:'POST', headers: authHeaders(true), body:'{}' });
      loadAnnouncements();
    }
    async function createAnnouncement() {
      const title = document.getElementById('anTitle')?.value?.trim();
      const body = document.getElementById('anBody')?.value?.trim();
      const required = !!document.getElementById('anReq')?.checked;
      if (!title || !body) { toast('Заполни заголовок и текст', 'err'); return; }
      const res = await fetch(API + '/announcements', { method:'POST', headers: authHeaders(true), body: JSON.stringify({ title, body, required }) });
      if (!res.ok) {
        let msg = 'Ошибка';
        try { const j = await res.json(); msg = j.message || j.error || msg; } catch(_){}
        toast(msg + ' (нужна таблица announcements)', 'err');
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
        const res = await fetch(API + '/reports/day/' + encodeURIComponent(sid) + '?date=' + encodeURIComponent(date), {
          headers: authHeaders()
        });
        const text = await res.text();
        let data = {};
        try { data = JSON.parse(text); } catch (_) {
          throw new Error(res.ok ? 'Не JSON от сервера' : (text.slice(0, 120) || 'HTTP ' + res.status));
        }
        if (!res.ok) {
          throw new Error(data.message || data.error || ('HTTP ' + res.status));
        }
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

    console.log('T2 Sales UI v14');

