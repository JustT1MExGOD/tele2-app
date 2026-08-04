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
        grid.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px">
          ${cells.map(c => {
            const intensity = c.value / max;
            const isBest = best.value > 0 && c.hour === best.hour;
            const bg = isBest
              ? 'rgba(52,199,89,0.35)'
              : `rgba(42,171,238,${0.12 + intensity * 0.75})`;
            return `<div style="background:${bg};border-radius:12px;padding:10px 6px;text-align:center;${isBest ? 'outline:2px solid #34c759' : ''}">
              <div style="font-size:11px;color:var(--hint)">${c.hour}:00</div>
              <div style="font-weight:800;font-size:16px">${c.value}</div>
            </div>`;
          }).join('')}
        </div>`;
      } catch (e) {
        if (meta) meta.textContent = '';
        grid.innerHTML = `<div class="empty">${e.message || e}<br><span style="font-size:11px">Нужен sales_events (sql/v8-0-roadmap.sql)</span></div>`;
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
        box.innerHTML = (data.items||[]).map(it => {
          const p = it.predicted||{};
          return `<div class="mt-card"><div class="mt-name">${it.date}</div><div class="mt-grid">
            <div class="mt-cell"><div class="v">${p.sim}</div><div class="l">SIM</div></div>
            <div class="mt-cell"><div class="v">${p.mnp}</div><div class="l">MNP</div></div>
            <div class="mt-cell"><div class="v">${p.pa}</div><div class="l">ПА</div></div>
            <div class="mt-cell"><div class="v">${p.combo}</div><div class="l">Комбо</div></div>
          </div></div>`;
        }).join('') || '<div class="empty">Нет данных</div>';
      } catch { box.innerHTML = '<div class="empty">Прогноз недоступен</div>'; }
    }
    async function runWhatIf() {
      const emp = Number(document.getElementById('wiEmp')?.value);
      const to = document.getElementById('wiTo')?.value;
      const from = document.getElementById('wiFrom')?.value || null;
      const date = document.getElementById('wiDate')?.value || todayMoscow();
      const box = document.getElementById('wiResult');
      if (!box) return;
      if (!emp || !to) { box.innerHTML = '<div class="empty">Укажи сотрудника и точку назначения</div>'; return; }
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const res = await fetch(API + '/schedule/what-if', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({
            date,
            moves: [{ employee_id: emp, from_store: from || null, to_store: to }]
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error || 'fail');
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
        window.__lastWhatIf = {
          date: data.date || date,
          moves: [{ employee_id: emp, from_store: from || null, to_store: to }]
        };
        const canApply = canManage() && (data.moves_applied || []).some(m => !m.skipped);
        box.innerHTML = `<div style="font-size:12px;color:var(--hint);margin-bottom:8px">Дата ${data.date || date}</div>
          ${sum.stores_gained?.length ? `<div style="color:#34c759;font-size:13px;margin-bottom:6px">↑ ${sum.stores_gained.join(', ')}</div>` : ''}
          ${sum.stores_lost?.length ? `<div style="color:#ff3b30;font-size:13px;margin-bottom:6px">↓ ${sum.stores_lost.join(', ')}</div>` : ''}
          ${rows || '<div class="empty">Нет точек</div>'}
          ${canApply ? `<button class="btn-main" style="margin-top:12px" onclick="applyWhatIf()">Записать сдвиг в график</button>
            <div style="font-size:11px;color:var(--hint);margin-top:6px;text-align:center">Реально обновит schedules на эту дату</div>` : ''}`;
      } catch (e) {
        box.innerHTML = `<div class="empty">${e.message || e}</div>`;
      }
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
        const items = data.items||[];
        if (!items.length) { box.innerHTML = '<div class="empty">Нет объявлений</div>'; return; }
        box.innerHTML = items.map(a => `<div class="mt-card">
          <div class="mt-name">${a.title||''} ${a.required?'· обязательно':''}</div>
          <div class="mt-meta">${a.is_read?'✓ прочитано':'не прочитано'} · ${String(a.created_at||'').slice(0,10)}</div>
          <div style="padding:8px 0;font-size:14px;line-height:1.45">${a.body||''}</div>
          ${a.is_read?'':`<button class="btn-main" onclick="markAnnouncementRead(${a.id})">Прочитал</button>`}
        </div>`).join('');
      } catch { box.innerHTML = '<div class="empty">Нужен v14 SQL + routes</div>'; }
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

