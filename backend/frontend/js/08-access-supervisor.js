/* 08-access-supervisor.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== ACCESS GATE =====
    function showAccessGate(st) {
      const gate = document.getElementById('accessGate');
      const body = document.getElementById('gateBody');
      const sub = document.getElementById('gateSubtitle');
      if (!gate || !body) {
        console.error('accessGate DOM missing');
        return;
      }
      // Gate всегда fixed поверх всего (вне .sheet)
      gate.style.cssText = 'display:block;position:fixed;inset:0;z-index:9999;background:var(--bg,#0a0a0b);overflow:auto;-webkit-overflow-scrolling:touch;visibility:visible;opacity:1;pointer-events:auto';
      const sheet = document.querySelector('.sheet');
      if (sheet) { sheet.style.visibility = 'hidden'; sheet.style.pointerEvents = 'none'; }
      const hdr = document.querySelector('.app-header');
      if (hdr) hdr.style.visibility = 'hidden';
      const nav = document.querySelector('.bottom-nav');
      if (nav) nav.style.display = 'none';
      const fab = document.querySelector('.fab');
      if (fab) fab.style.display = 'none';

      const status = st.status || st.user?.access_status || 'none';
      const tgName = [tgUser()?.first_name, tgUser()?.last_name].filter(Boolean).join(' ').trim();
      const tid = tgUser()?.id || '—';

      if (status === 'pending') {
        if (sub) sub.textContent = 'Заявка на проверке';
        body.innerHTML = `
          <div class="gate-card">
            <div class="bind-glow"></div>
            <div style="font-size:40px;text-align:center;margin-bottom:8px;position:relative">⏳</div>
            <div class="gate-title">Ожидайте подтверждения</div>
            <div class="gate-desc">
              Manager или супервайзер подтвердит, что вы сотрудник сети.
              Обычно это несколько минут.
            </div>
            <button class="btn-main" onclick="bootApp()">Обновить статус</button>
          </div>`;
        return;
      }

      if (status === 'rejected' || status === 'blocked') {
        if (sub) sub.textContent = 'Доступ закрыт';
        body.innerHTML = `
          <div class="gate-card">
            <div class="bind-glow"></div>
            <div style="font-size:40px;text-align:center;margin-bottom:8px;position:relative">🔒</div>
            <div class="gate-title">В доступе отказано</div>
            <div class="gate-desc">
              Напиши управляющему или admin.
              Если ошибка — пусть выставят access_status = active.
            </div>
            <div class="bind-foot" style="position:relative;margin-bottom:12px">Telegram ID: <code>${tid}</code></div>
            <button class="btn-main" onclick="bootApp()">Проверить снова</button>
            <button class="btn-main" style="margin-top:8px;background:var(--surface-2);color:var(--text)"
              onclick="showAccessGate({status:'none'})">Подать заявку заново</button>
          </div>`;
        return;
      }

      // none — форма регистрации
      if (sub) sub.textContent = 'Регистрация · один раз';
      body.innerHTML = `
        <div class="gate-card">
          <div class="bind-glow"></div>
          <div class="gate-title">Добро пожаловать</div>
          <div class="gate-desc">
            Укажи ФИО как в команде. После подтверждения manager откроется полный доступ к плану, сменам и продажам.
          </div>
          <div class="field">
            <label>ФИО</label>
            <input id="gateName" placeholder="Иванов Иван Иванович" value="${(tgName || '').replace(/"/g, '&quot;')}">
          </div>
          <div class="field">
            <label>Комментарий</label>
            <input id="gateMsg" placeholder="Точка / с какого числа">
          </div>
          <div class="field">
            <label>Я из списка</label>
            <select id="gateClaim"><option value="">— новый сотрудник —</option></select>
          </div>
          <button class="btn-main" style="margin-top:8px" onclick="submitAccessRequest()">Отправить заявку</button>
          <div class="bind-foot" style="position:relative;margin-top:14px">ID: ${tid} · T2 Sales ${typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''}</div>
        </div>`;
      loadGateDirectory();
    }

    function hideAccessGate() {
      const gate = document.getElementById('accessGate');
      if (gate) gate.style.display = 'none';
      const sheet = document.querySelector('.sheet');
      if (sheet) { sheet.style.visibility = 'visible'; sheet.style.pointerEvents = ''; }
      const hdr = document.querySelector('.app-header');
      if (hdr) hdr.style.visibility = '';
      const nav = document.querySelector('.bottom-nav');
      if (nav) nav.style.display = '';
      const fab = document.querySelector('.fab');
      if (fab) fab.style.display = 'flex';
    }

    async function loadGateDirectory() {
      try {
        const res = await fetch(API + '/access/employees-directory');
        if (!res.ok) return;
        const list = await res.json();
        const sel = document.getElementById('gateClaim');
        if (!sel) return;
        list.forEach(e => {
          const o = document.createElement('option');
          o.value = e.id;
          o.textContent = e.full_name;
          sel.appendChild(o);
        });
      } catch (_) {}
    }

    async function submitAccessRequest() {
      const full_name = document.getElementById('gateName')?.value?.trim();
      if (!full_name || full_name.length < 3) {
        toast('Укажите ФИО', 'err');
        return;
      }
      const claimed = document.getElementById('gateClaim')?.value;
      const body = {
        full_name,
        message: document.getElementById('gateMsg')?.value || '',
        username: tgUser()?.username || null,
        claimed_employee_id: claimed ? Number(claimed) : null
      };
      const res = await fetch(API + '/access/request', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Ошибка', 'err');
        return;
      }
      toast('Заявка отправлена', 'ok');
      showAccessGate({ status: 'pending' });
    }

    async function bootApp() {
      applyTheme(localStorage.getItem('t2_theme') || 'light');
      document.getElementById('headerDate').textContent = formatDateRu(todayMoscow());

      const user = tgUser();
      if (!user?.id) {
        // вне Telegram — для отладки пускаем, но в проде лучше gate
        hideAccessGate();
        applyBranding();
        loadHome();
        return;
      }

      try {
        const res = await fetch(API + '/access/status', { headers: authHeaders() });

        // Если роута ещё нет (404) — не блокируем, пускаем через /me
        if (res.status === 404) {
          console.warn('/access/status not found — skip gate');
          try {
            const meRes = await fetch(API + '/me', { headers: authHeaders() });
            if (meRes.ok) me = await meRes.json();
          } catch (_) {}
          hideAccessGate();
          loadHome();
          maybeOfferTutorial();
          return;
        }

        const st = await res.json().catch(() => ({}));
        const status = st.status === 'active' || st.user?.access_status === 'active'
          ? 'active'
          : (st.status || st.user?.access_status || 'none');

        if (status === 'anonymous' || status === 'none' || status === 'pending' || status === 'rejected' || status === 'blocked') {
          // anonymous без telegram — уже обработан выше
          if (status !== 'anonymous') {
            showAccessGate(st);
            return;
          }
        }

        me = st.user || me;
        try {
          const meRes = await fetch(API + '/me', { headers: authHeaders() });
          if (meRes.ok) {
            const m = await meRes.json();
            me = { ...me, ...m };
          }
        } catch (_) {}

        hideAccessGate();

        const btnAcc = document.getElementById('btnAccessRequests');
        const btnSv = document.getElementById('btnSupervisor');
        if (btnAcc) btnAcc.style.display = canApprove() ? '' : 'none';
        if (btnSv) btnSv.style.display = (canManage() || isSupervisor()) ? '' : 'none';
        const btnMgrTut = document.getElementById('btnMgrTutorial');
        if (btnMgrTut) btnMgrTut.style.display = canManage() ? '' : 'none';

        loadHome();
        maybeOfferTutorial();
      } catch (e) {
        console.error(e);
        // сеть/парс — не запираем в gate навечно
        try {
          const meRes = await fetch(API + '/me', { headers: authHeaders() });
          if (meRes.ok) me = await meRes.json();
        } catch (_) {}
        hideAccessGate();
        loadHome();
      }
    }

    // ===== ACCESS REQUESTS UI =====
    async function loadSupportSla() {
      if (!canAdmin()) return;
      try {
        const res = await fetch(API + '/support/admin/tickets', { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const box = document.getElementById('supportSlaBox');
        if (!box) return;
        const items = data.items || [];
        if (!items.length) { box.innerHTML = ''; return; }
        box.innerHTML = '<div class="section-title">SLA тикетов</div>' + items.slice(0, 15).map(t => {
          const st = t.sla_status || '';
          const col = st === 'breached' ? '#ff3b30' : st === 'waiting' ? '#ff9f0a' : '#34c759';
          return `<div class="progress-block" style="margin:6px 12px;padding:10px;border-left:3px solid ${col}">
            <div style="font-weight:600;font-size:13px">${esc(t.full_name || t.category || 'Тикет #' + t.id)}</div>
            <div style="font-size:11px;color:var(--hint)">${st} · due ${String(t.sla_due_at || '').slice(0, 16)}</div>
          </div>`;
        }).join('');
      } catch (_) {}
    }

    async function loadAccessRequests() {
      const box = document.getElementById('accessList');
      if (!canAdmin() && !canApprove()) {
        box.innerHTML = '<div class="empty">Только manager / супервайзер</div>';
        return;
      }
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const res = await fetch(API + '/access/requests', { headers: authHeaders() });
        if (!res.ok) throw new Error('fail');
        const list = await res.json();
        if (!list.length) {
          box.innerHTML = '<div class="empty">Нет заявок</div>';
          return;
        }
        box.innerHTML = list.map(r => `
          <div class="progress-block" style="margin:8px 12px">
            <div class="row-title">${esc(r.full_name)}</div>
            <div class="row-sub">TG ${r.telegram_id}${r.message ? ' · ' + esc(r.message) : ''}</div>
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn-main" style="flex:1" onclick="approveAccess(${r.id})">Подтвердить</button>
              <button class="btn-main" style="flex:1;background:#ff3b30" onclick="rejectAccess(${r.id})">Отклонить</button>
            </div>
          </div>`).join('');
      } catch {
        box.innerHTML = '<div class="empty">Ошибка загрузки</div>';
      }
    }

    async function approveAccess(id) {
      const res = await fetch(API + '/access/requests/' + id + '/approve', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ role: 'employee' })
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      toast('Доступ открыт', 'ok');
      loadAccessRequests();
    }

    async function rejectAccess(id) {
      const res = await fetch(API + '/access/requests/' + id + '/reject', {
        method: 'POST',
        headers: authHeaders(true),
        body: '{}'
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      toast('Отклонено', 'ok');
      loadAccessRequests();
    }

    // ===== SUPERVISOR DASH =====
    function svTone(pct) {
      if (pct >= 85) return 'good';
      if (pct >= 50) return 'mid';
      return 'bad';
    }
    function svBarColor(pct) {
      if (pct >= 100) return '#30D158';
      if (pct >= 50) return '#FF9F0A';
      return '#FF453A';
    }
    function svHealthColor(h) {
      if (h >= 75) return '#30D158';
      if (h >= 45) return '#FF9F0A';
      return '#FF453A';
    }

    function sparklineSVG(trend, key = 'units') {
      if (!trend || !trend.length) return '<div class="empty" style="padding:12px">Нет ряда</div>';
      const vals = trend.map(t => Number(t[key]) || 0);
      const max = Math.max(1, ...vals);
      const w = 320, h = 100, pad = 8;
      const step = (w - pad * 2) / Math.max(1, vals.length - 1);
      const pts = vals.map((v, i) => {
        const x = pad + i * step;
        const y = h - pad - (v / max) * (h - pad * 2);
        return [x, y];
      });
      const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      const area = line + ` L${pts[pts.length-1][0]},${h-pad} L${pts[0][0]},${h-pad} Z`;
      return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="svFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2AABEE" stop-opacity=".35"/>
            <stop offset="100%" stop-color="#2AABEE" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#svFill)"/>
        <path d="${line}" fill="none" stroke="#2AABEE" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${pts.length ? `<circle cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="3.5" fill="#fff" stroke="#2AABEE" stroke-width="2"/>` : ''}
      </svg>`;
    }

    async function loadSupervisorDash() {
      const box = document.getElementById('supervisorBody');
      if (!box) return;
      box.innerHTML = '<div class="skeleton" style="margin:16px"></div><div class="skeleton" style="margin:16px;height:120px"></div>';
      try {
        const res = await fetch(API + '/supervisor/dashboard?days=14', { headers: authHeaders() });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || ('HTTP ' + res.status));
        }
        const d = await res.json();
        const net = d.network || {};
        const health = Number(net.health) || 0;
        const hColor = svHealthColor(health);
        const pace = Number(net.pace_delta) || 0;
        const paceClass = pace >= 0 ? 'ahead' : 'behind';
        const paceText = pace >= 0 ? ('+' + pace + '% к темпу дня') : (pace + '% к темпу дня');

        let html = `
          <div class="sv-hero">
            <div class="sv-kicker">Supervisor · T2 Analytics</div>
            <div class="sv-title">Сеть под контролем</div>
            <div class="sv-sub">${d.date || ''} · ${net.stores_count || 0} точек · на смене ${net.staff_on_shift || 0}</div>
            <div class="sv-health-row">
              <div class="sv-ring" style="--sv-p:${health};--sv-h:${hColor}"><span style="color:${hColor}">${health}</span></div>
              <div class="sv-metrics">
                <div class="sv-metric"><div class="n">${net.overall_pct || 0}%</div><div class="l">План дня</div></div>
                <div class="sv-metric"><div class="n">${net.day_progress_pct || 0}%</div><div class="l">Прогресс дня</div></div>
                <div class="sv-metric"><div class="n">${net.sim || 0}/${net.plan_sim || 0}</div><div class="l">SIM</div></div>
                <div class="sv-metric"><div class="n">${net.mnp || 0}/${net.plan_mnp || 0}</div><div class="l">MNP</div></div>
              </div>
            </div>
            <div class="sv-pace">
              <span>Темп: <b class="${paceClass}">${paceText}</b></span>
              <span>Просадки: <b>${net.drops_count || 0}</b></span>
            </div>
          </div>
        `;

        // drops
        html += `<div class="sv-section">Просадки и риски <span>· live</span></div>`;
        if ((d.drops || []).length) {
          html += d.drops.map(x => `
            <div class="sv-drop ${x.severity === 'critical' ? '' : 'warn'}">
              <div class="ico">${x.severity === 'critical' ? '🚨' : '⚠️'}</div>
              <div>
                <div class="t">${x.store_name || 'Точка'}</div>
                <div class="s">${x.message}${x.overall != null ? ' · ' + x.overall + '% плана' : ''}</div>
              </div>
            </div>`).join('');
        } else {
          html += `<div class="empty" style="padding:12px 16px">Критических просадок нет — сеть в ритме</div>`;
        }

        // trend chart
        html += `
          <div class="sv-section">Динамика 14 дней <span>· units (SIM+MNP+ПА+Комбо)</span></div>
          <div class="sv-chart">
            ${sparklineSVG(d.trend || [], 'units')}
            <div class="sv-chart-legend">
              <span><i style="background:#2AABEE"></i>Units / день</span>
              <span>с ${d.from || ''} по ${d.date || ''}</span>
            </div>
          </div>
        `;

        // stores
        html += `<div class="sv-section">Точки <span>· сортировка: слабые сверху</span></div>`;
        html += (d.stores || []).map(s => {
          const t = s.today || {};
          const o = Number(t.overall) || 0;
          const badge = svTone(o);
          const bars = [
            { l: 'SIM', f: t.sim, p: t.plan_sim, pc: t.pct_sim },
            { l: 'MNP', f: t.mnp, p: t.plan_mnp, pc: t.pct_mnp },
            { l: 'ПА', f: t.pa, p: t.plan_pa, pc: t.pct_pa }
          ].map(b => {
            const pc = Number(b.pc) || 0;
            return `<div class="sv-bar-row">
              <div>${b.l}</div>
              <div class="sv-bar-track"><div class="sv-bar-fill" style="width:${Math.min(100,pc)}%;background:${svBarColor(pc)}"></div></div>
              <div style="text-align:right">${b.f||0}/${b.p||0}</div>
            </div>`;
          }).join('');
          const staff = (s.staff || []).map(x => x.name.split(' ')[0]).join(', ') || '—';
          const alerts = (s.alerts || []).map(a => `<div style="font-size:11px;color:#FF9F0A;margin-top:4px">• ${a}</div>`).join('');
          return `<div class="sv-store" style="--sc:${s.color || '#2AABEE'}">
            <div class="sv-store-head">
              <div>
                <div class="sv-store-name">${s.name}</div>
                <div class="sv-store-code">${s.code || ''} · на смене ${s.staff_count || 0}</div>
              </div>
              <div class="sv-badge ${badge}">${o}%</div>
            </div>
            <div class="sv-bars">${bars}</div>
            <div class="sv-staff">👥 ${staff}</div>
            ${alerts}
          </div>`;
        }).join('') || '<div class="empty">Нет точек</div>';

        // top
        html += `<div class="sv-section">Топ продавцов <span>· ${d.from || ''}–${d.date || ''}</span></div>`;
        html += (d.top_employees || []).map((e, i) => `
          <div class="sv-rank">
            <div class="pos ${i < 3 ? 'gold' : ''}">${e.rank || i + 1}</div>
            <div class="body">
              <div class="name">${esc(e.full_name)}</div>
              <div class="sub">SIM ${e.sim} · MNP ${e.mnp} · ПА ${e.pa} · score ${e.score}</div>
            </div>
          </div>`).join('') || '<div class="empty">Нет продаж за период</div>';

        html += `<div style="height:24px"></div>`;
        box.innerHTML = html;
      } catch (e) {
        console.error(e);
        box.innerHTML = `<div class="empty">Кабинет супервайзера недоступен<br><span style="font-size:12px;opacity:.7">${(e && e.message) ? e.message : e}</span><br><span style="font-size:11px;opacity:.5">Проверь роль и ✅ Supervisor routes registered</span></div>`;
      }
    }


    // init
    bootApp();

