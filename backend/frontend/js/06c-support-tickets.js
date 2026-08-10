/* 06c-support-tickets.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен.
   История продаж, поддержка/FAQ/тикеты, копирование графика на неделю,
   CSV-экспорты (вынесено из 06-team-bfq.js). */
    async function loadHistory() {
      const box = document.getElementById('historyList');
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const from = todayMoscow().slice(0, 8) + '01';
        const to = todayMoscow();
        const res = await fetch(
          `${API}/sales/history?from=${from}&to=${to}${orgQueryParam()}`,
          { headers: authHeaders() }
        );
        if (!res.ok) throw new Error('fail');
        const data = await res.json();
        const items = data.items || [];
        if (!items.length) {
          box.innerHTML = '<div class="empty">Нет продаж за период</div>';
          return;
        }
        box.innerHTML = items.map(s => `
          <div class="row">
            <div class="row-body">
              <div class="row-title">${esc(s.full_name)}</div>
              <div class="row-sub">${String(s.sale_date).slice(0, 10)} · ${esc(s.store_name)}
                · SIM ${s.sim || 0} · MNP ${s.mnp || 0} · ПА ${s.pa || 0}</div>
            </div>
          </div>
        `).join('');
      } catch {
        box.innerHTML = '<div class="empty">Нужна привязка Telegram</div>';
      }
    }

    function mondayOf(d) {
      const x = new Date(d + 'T12:00:00');
      const day = x.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      x.setDate(x.getDate() + diff);
      return x.toISOString().slice(0, 10);
    }

    async function copyScheduleWeek() {
      if (!canManage()) return;
      const from = mondayOf(todayMoscow());
      const toD = new Date(from + 'T12:00:00');
      toD.setDate(toD.getDate() + 7);
      const to = toD.toISOString().slice(0, 10);
      if (!confirm(`Скопировать график ${from} → неделя с ${to}?`)) return;
      const res = await fetch(API + '/schedules/copy-week', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ from_monday: from, to_monday: to })
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      const data = await res.json();
      toast('Скопировано смен: ' + (data.copied || 0), 'ok');
    }

    async function loadSupport() {
      const box = document.getElementById('faqList');
      try {
        const res = await fetch(API + '/support/faq', { headers: authHeaders() });
        const list = res.ok ? await res.json() : [];
        if (!list.length) {
          box.innerHTML = '<div class="empty">FAQ пока пуст</div>';
        } else {
          box.innerHTML = list.map(f => `
            <button class="row" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'">
              <div class="row-body"><div class="row-title">${f.question}</div></div>
              <div class="row-chevron">›</div>
            </button>
            <div class="empty" style="display:none;text-align:left;padding:0 16px 14px;color:var(--text-secondary)">${f.answer}</div>
          `).join('');
        }
      } catch {
        box.innerHTML = '<div class="empty">Не удалось загрузить FAQ</div>';
      }

      // мой чат / последние тикеты
      const chat = document.getElementById('supportChat');
      if (chat) {
        try {
          const r = await fetch(API + '/support/my', { headers: authHeaders() });
          if (r.ok) {
            const tickets = await r.json();
            if (!tickets.length) {
              chat.innerHTML = '<div class="empty" style="padding:8px 0">Пока нет обращений</div>';
            } else {
              chat.innerHTML = tickets.slice(0, 8).map(tk => `
                <div class="progress-block" style="margin-bottom:8px;padding:10px 12px">
                  <div style="font-size:12px;color:var(--hint)">#${tk.id} · ${tk.status || ''}</div>
                  <div style="font-size:14px;margin:4px 0">${esc(tk.message || '')}</div>
                  ${tk.admin_reply ? `<div style="font-size:13px;color:var(--primary);margin-top:6px">↩ ${esc(tk.admin_reply)}</div>` : ''}
                </div>
              `).join('');
            }
          }
        } catch (_) {}
      }

      const adm = document.getElementById('adminTicketsSection');
      if (adm && canAdmin()) {
        adm.style.display = '';
        try {
          const r = await fetch(API + '/support/tickets', { headers: authHeaders() });
          const list = r.ok ? await r.json() : [];
          const box2 = document.getElementById('adminTicketsList');
          if (!list.length) box2.innerHTML = '<div class="empty">Нет тикетов</div>';
          else box2.innerHTML = list.map(tk => `
            <div class="row" style="flex-direction:column;align-items:stretch;gap:6px">
              <div class="row-title">#${tk.id} ${esc(tk.full_name || '')}</div>
              <div class="row-sub">${esc(tk.message || '')}</div>
              <button class="btn-main" style="margin-top:4px" onclick="replyTicketPrompt(${tk.id})">Ответить</button>
            </div>
          `).join('');
        } catch (_) {}
      } else if (adm) {
        adm.style.display = 'none';
      }
    }

    // Поддержка (раздел «Поддержка», простой prompt()). Раньше называлась
    // так же, как replyTicket ниже — из-за этого вообще не работала:
    // JS хостит function-декларации, и вторая, более поздняя, тихо
    // перетирала первую в глобальной области.
    async function replyTicketPrompt(id) {
      if (!canAdmin()) { toast('Только admin', 'err'); return; }
      const text = prompt('Ответ на тикет #' + id);
      if (!text) return;
      const res = await fetch(API + '/support/tickets/' + id + '/reply', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ reply: text })
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      toast('Ответ отправлен', 'ok');
      loadSupport();
    }

    async function sendSupport() {
      const message = document.getElementById('supportMsg').value.trim();
      if (!message) { toast('Введите сообщение', 'err'); return; }
      try {
        const res = await fetch(API + '/support', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({
            message,
            telegram_id: tgUser()?.id,
            full_name: me?.full_name || tgUser()?.first_name || 'Гость'
          })
        });
        const data = await res.json();
        const el = document.getElementById('supportResult');
        el.style.display = 'block';
        el.textContent = data.auto_reply || data.message || 'Отправлено';
        document.getElementById('supportMsg').value = '';
        toast('Отправлено', 'ok');
      } catch {
        toast('Ошибка отправки', 'err');
      }
    }

    async function loadManagerTickets() {
      if (!canAdmin()) return;
      const box = document.getElementById('ticketsBox');
      box.innerHTML = '<div class="section"><div class="section-title">Тикеты</div><div class="skeleton"></div></div>';
      try {
        const res = await fetch(API + '/support/tickets', { headers: authHeaders() });
        if (!res.ok) throw new Error('fail');
        const list = await res.json();
        const open = (list || []).filter(t => t.status !== 'closed');
        box.innerHTML = `<div class="section"><div class="section-title">Тикеты (${open.length})</div>` +
          (open.length ? open.map(t => `
            <div class="progress-block" style="margin:8px 12px">
              <div class="row-title">#${t.id} · ${esc(t.full_name || 'Гость')} · ${t.status}</div>
              <div class="row-sub" style="margin:6px 0">${esc(t.message)}</div>
              ${t.admin_reply ? `<div class="empty" style="text-align:left">Ответ: ${esc(t.admin_reply)}</div>` : `
              <div class="field"><input id="treply_${t.id}" placeholder="Ответ сотруднику"></div>
              <button class="btn-main" onclick="replyTicket(${t.id})">Ответить в личку</button>`}
            </div>`).join('') : '<div class="empty">Нет открытых</div>') + '</div>';
      } catch {
        box.innerHTML = '<div class="empty">Не удалось загрузить тикеты</div>';
      }
    }

    async function replyTicket(id) {
      const text = document.getElementById('treply_' + id)?.value?.trim();
      if (!text) { toast('Введите ответ', 'err'); return; }
      const res = await fetch(API + '/support/tickets/' + id + '/reply', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ reply: text })
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      toast('Ответ отправлен', 'ok');
      loadManagerTickets();
    }

    async function exportCSV(type) {
      if (!canManage()) { toast('Только управляющий', 'err'); return; }
      const month = todayMoscow().slice(0, 7);
      const from = month + '-01';
      const to = todayMoscow();
      let path = '';
      if (type === 'sales') path = `/export/sales.csv?from=${from}&to=${to}`;
      if (type === 'bfq') path = `/export/bfq.csv?month=${month}`;
      if (type === 'schedules') path = `/export/schedules.csv?month=${month}`;
      path += orgQueryParam();
      try {
        const res = await fetch(API + path, { headers: authHeaders() });
        if (!res.ok) { toast('Ошибка экспорта', 'err'); return; }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = type + '_' + month + '.csv';
        a.click();
        toast('Скачано', 'ok');
      } catch {
        toast('Ошибка', 'err');
      }
    }
