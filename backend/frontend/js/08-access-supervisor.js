/* 08-access-supervisor.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== ACCESS GATE =====
    // Скрывает сплэш загрузки. Вызывается из hideAccessGate() и
    // showAccessGate() — это единственные две точки, которыми
    // bootApp() (все 5 его веток) завершает первый round-trip, поэтому
    // сплэш гарантированно скрывается на любом исходе, включая ошибку сети.
    function hideSplash() {
      const s = document.getElementById('appSplash');
      if (s) s.style.display = 'none';
    }

    function showAccessGate(st) {
      hideSplash();
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
            <div class="gate-icon warn">⏳</div>
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
            <div class="gate-icon danger"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" /> </svg></div>
            <div class="gate-title">В доступе отказано</div>
            <div class="gate-desc">
              Напиши управляющему или admin.
              Если ошибка — пусть выставят access_status = active.
            </div>
            <div class="bind-foot" style="position:relative;margin-bottom:12px">Telegram ID: <code>${tid}</code></div>
            <button class="btn-main" onclick="bootApp()">Проверить снова</button>
            <button class="btn-ghost" onclick="showAccessGate({status:'none'})">Подать заявку заново</button>
          </div>`;
        return;
      }

      // none — форма регистрации
      if (sub) sub.textContent = 'Регистрация · один раз';
      body.innerHTML = `
        <div class="gate-card">
          <div class="bind-glow"></div>
          <div class="gate-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" /> <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" /> <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" /> <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /> </svg></div>
          <div class="gate-title">Добро пожаловать</div>
          <div class="gate-desc">
            Укажи ФИО как в команде. После подтверждения manager откроется полный доступ к плану, сменам и продажам.
          </div>
          <div class="field" id="gateOrgField">
            <label>Сеть</label>
            <select id="gateOrg"><option value="" disabled selected>— выбери сеть —</option></select>
            <div class="bind-foot" id="gateOrgHint" style="display:none;margin-top:6px">Сеть определится по выбранному сотруднику</div>
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
            <select id="gateClaim" onchange="onGateClaimChange()"><option value="">— новый сотрудник —</option></select>
          </div>
          <button class="btn-main" style="margin-top:8px" onclick="submitAccessRequest()">Отправить заявку</button>
          <div class="bind-foot" style="position:relative;margin-top:14px">ID: ${tid} · T2 Sales ${typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''}</div>
        </div>`;
      loadGateOrgs();
    }

    function hideAccessGate() {
      hideSplash();
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

    // Список сетей для пикера — единственный вариант автовыбирается и
    // прячется (нет смысла выбирать из одного). При выборе сети — только
    // тогда подгружается claim-список, отфильтрованный по ней (без
    // выбранной сети список не грузим вообще, иначе гость сети B опять
    // мог бы «заклеймить» сотрудника сети A).
    async function loadGateOrgs() {
      try {
        const list = await window.apiClient.getAccessOrgs(authHeaders());
        const sel = document.getElementById('gateOrg');
        const field = document.getElementById('gateOrgField');
        if (!sel) return;
        const orgs = Array.isArray(list) ? list : [];
        orgs.forEach(o => {
          const opt = document.createElement('option');
          opt.value = o.id;
          opt.textContent = o.name;
          sel.appendChild(opt);
        });
        if (orgs.length <= 1) {
          if (orgs.length === 1) sel.value = orgs[0].id;
          if (field) field.style.display = 'none';
          loadGateDirectory(sel.value);
        } else {
          sel.onchange = () => loadGateDirectory(sel.value);
        }
      } catch (_) {}
    }

    async function loadGateDirectory(orgId) {
      try {
        const orgParam = orgId ? '?org_id=' + encodeURIComponent(orgId) : '';
        const list = await window.apiClient.getAccessDirectory(authHeaders(), orgParam);
        const sel = document.getElementById('gateClaim');
        if (!sel) return;
        sel.innerHTML = '<option value="">— новый сотрудник —</option>';
        (Array.isArray(list) ? list : []).forEach(e => {
          const o = document.createElement('option');
          o.value = e.id;
          o.textContent = e.full_name;
          sel.appendChild(o);
        });
      } catch (_) {}
    }

    // Claim выбран — сеть сотрудника уже известна сама по себе, пикер
    // блокируется, чтобы не путать (выбор сети никак не влияет на claim).
    function onGateClaimChange() {
      const claim = document.getElementById('gateClaim')?.value;
      const orgSel = document.getElementById('gateOrg');
      const hint = document.getElementById('gateOrgHint');
      if (orgSel) orgSel.disabled = !!claim;
      if (hint) hint.style.display = claim ? 'block' : 'none';
    }

    async function submitAccessRequest() {
      const full_name = document.getElementById('gateName')?.value?.trim();
      if (!full_name || full_name.length < 3) {
        toast('Укажите ФИО', 'err');
        return;
      }
      const claimed = document.getElementById('gateClaim')?.value;
      const orgVal = document.getElementById('gateOrg')?.value;
      if (!claimed && !orgVal) {
        toast('Выберите сеть', 'err');
        return;
      }
      const body = {
        full_name,
        message: document.getElementById('gateMsg')?.value || '',
        username: tgUser()?.username || null,
        claimed_employee_id: claimed ? Number(claimed) : null,
        org_id: claimed ? null : (orgVal || null)
      };
      try {
        await window.apiClient.submitAccessRequest(authHeaders(true), body);
      } catch (e) {
        toast(e.message || 'Ошибка', 'err');
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
        if (typeof applyBranding === 'function') applyBranding();
        enterHomeOrSupervisorShell();
        return;
      }

      try {
        const res = await fetch(API + '/access/status', { headers: authHeaders() });

        // Если роута ещё нет (404) — не блокируем, пускаем через /me
        if (res.status === 404) {
          console.warn('/access/status not found — skip gate');
          try {
            me = await window.apiClient.getMe(authHeaders());
          } catch (_) {}
          hideAccessGate();
          enterHomeOrSupervisorShell();
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
          const m = await window.apiClient.getMe(authHeaders());
          me = { ...me, ...m };
        } catch (_) {}

        hideAccessGate();

        const btnAcc = document.getElementById('btnAccessRequests');
        const btnSv = document.getElementById('btnSupervisor');
        if (btnAcc) btnAcc.style.display = canApprove() ? '' : 'none';
        // «Кабинет супервайзера» — теперь только явная кнопка для admin
        // (canAdmin(), не canViewAnalytics()); manager/senior её больше не
        // видят вообще — кабинет изолирован от них, у admin это осознанный
        // «заглянуть», а не дефолтный вид.
        if (btnSv) btnSv.style.display = canAdmin() ? '' : 'none';
        const btnMgrTut = document.getElementById('btnMgrTutorial');
        if (btnMgrTut) btnMgrTut.style.display = canManage() ? '' : 'none';

        enterHomeOrSupervisorShell();
        maybeOfferTutorial();
      } catch (e) {
        console.error(e);
        // сеть/парс — не запираем в gate навечно
        try {
          me = await window.apiClient.getMe(authHeaders());
        } catch (_) {}
        hideAccessGate();
        enterHomeOrSupervisorShell();
      }
    }

    // ===== ACCESS REQUESTS UI =====
    async function loadSupportSla() {
      if (!canAdmin()) return;
      try {
        const data = await window.apiClient.getSupportAdminTickets(authHeaders());
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
        const list = await window.apiClient.getAccessRequests(authHeaders());
        if (!list.length) {
          box.innerHTML = '<div class="empty">Нет заявок</div>';
          return;
        }
        const myAssignable = assignableRoles(me?.role);
        const roleOptions = (myAssignable.length ? myAssignable : ['employee'])
          .map((r) => `<option value="${r}"${r === 'employee' ? ' selected' : ''}>${roleLabel(r)}</option>`)
          .join('');
        box.innerHTML = list.map(r => `
          <div class="progress-block" style="margin:8px 12px">
            <div class="row-title">${esc(r.full_name)}</div>
            <div class="row-sub">TG ${r.telegram_id}${r.message ? ' · ' + esc(r.message) : ''}</div>
            <select id="role_req_${r.id}" style="margin-top:8px;width:100%">${roleOptions}</select>
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
      const roleSel = document.getElementById('role_req_' + id);
      const role = roleSel ? roleSel.value : 'employee';
      try {
        await window.apiClient.approveAccessRequest(authHeaders(true), id, { role });
      } catch (e) {
        toast('Ошибка', 'err');
        return;
      }
      toast('Доступ открыт', 'ok');
      loadAccessRequests();
    }

    async function rejectAccess(id) {
      try {
        await window.apiClient.rejectAccessRequest(authHeaders(true), id);
      } catch (e) {
        toast('Ошибка', 'err');
        return;
      }
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
            <stop offset="0%" stop-color="#8B5CF6" stop-opacity=".35"/>
            <stop offset="100%" stop-color="#8B5CF6" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#svFill)"/>
        <path d="${line}" fill="none" stroke="#8B5CF6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${pts.length ? `<circle cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="3.5" fill="#fff" stroke="#8B5CF6" stroke-width="2"/>` : ''}
      </svg>`;
    }

    // ===== SUPERVISOR SHELL — отдельный визуал, изолирован от manager/senior.
    // Реальный supervisor видит ТОЛЬКО этот shell (см. enterHomeOrSupervisorShell()
    // в bootApp() ниже) — обычные 5 вкладок для него не монтируются вообще.
    // admin заходит через кнопку «Кабинет супервайзера» и видит «‹ Назад».
    let svDashData = null;

    function enterSupervisorShell() {
      const mainNav = document.getElementById('bottomNavMain');
      const svNav = document.getElementById('bottomNavSupervisor');
      if (mainNav) mainNav.style.display = 'none';
      if (svNav) svNav.style.display = 'flex';
      const exitBtn = document.getElementById('svExitBtn');
      // Реальному supervisor'у возвращаться некуда — у него нет обычного
      // shell, кнопка «Назад» только для admin, который сюда заглянул.
      if (exitBtn) exitBtn.style.display = isSupervisor() ? 'none' : '';
      switchPage('sv-overview');
      loadSupervisorData(false);
    }

    function exitSupervisorShell() {
      const mainNav = document.getElementById('bottomNavMain');
      const svNav = document.getElementById('bottomNavSupervisor');
      if (svNav) svNav.style.display = 'none';
      if (mainNav) mainNav.style.display = 'flex';
      switchPage('home');
    }

    /** Единая точка ветвления для всех веток bootApp(), где раньше был
     * loadHome() — по аналогии с hideSplash(), не патчим 4 места отдельно. */
    function enterHomeOrSupervisorShell() {
      if (me?.role === 'supervisor') { enterSupervisorShell(); }
      else { loadHome(); }
    }

    async function loadSupervisorData(forceRefresh) {
      if (svDashData && !forceRefresh) { renderSvAll(svDashData); return; }
      const days = document.getElementById('svTrendDays')?.value || 14;
      ['svOverviewBody', 'svStoresBody', 'svPeopleBody', 'svTrendBody'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<div class="skeleton" style="margin:16px"></div>';
      });
      try {
        svDashData = await window.apiClient.getSupervisorDashboard(authHeaders(), days, orgQueryParam());
        renderSvAll(svDashData);
      } catch (e) {
        console.error(e);
        const msg = `<div class="empty">Кабинет супервайзера недоступен<br><span style="font-size:12px;opacity:.7">${(e && e.message) ? e.message : e}</span></div>`;
        ['svOverviewBody', 'svStoresBody', 'svPeopleBody', 'svTrendBody'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.innerHTML = msg;
        });
      }
    }

    function renderSvAll(d) {
      renderSvOverview(d);
      renderSvStores(d);
      renderSvPeople(d);
      renderSvTrend(d);
    }

    function renderSvOverview(d) {
      const box = document.getElementById('svOverviewBody');
      if (!box) return;
      const net = d.network || {};
      const health = Number(net.health) || 0;
      const hColor = svHealthColor(health);
      const pace = Number(net.pace_delta) || 0;
      const paceClass = pace >= 0 ? 'ahead' : 'behind';
      const paceText = pace >= 0 ? ('+' + pace + '% к темпу дня') : (pace + '% к темпу дня');

      let html = `
        <div class="sv-hero">
          <div class="sv-kicker">Supervisor · T2 Analytics</div>
          <div class="sv-title">Сектор под контролем</div>
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

      html += `<div class="sv-section">Просадки и риски <span>· live</span></div>`;
      if ((d.drops || []).length) {
        html += d.drops.map(x => `
          <div class="sv-drop ${x.severity === 'critical' ? '' : 'warn'}">
            <div class="ico">${x.severity === 'critical' ? '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M7 18v-6a5 5 0 1 1 10 0v6" /> <path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z" /> <path d="M21 12h1" /> <path d="M18.5 4.5 18 5" /> <path d="M2 12h1" /> <path d="M12 2v1" /> <path d="m4.929 4.929.707.707" /> <path d="M12 12v6" /> </svg>' : '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" /> </svg>'}</div>
            <div style="flex:1">
              <div class="t">${esc(x.store_name || 'Точка')}</div>
              <div class="s">${esc(x.message || '')}${x.overall != null ? ' · ' + x.overall + '% плана' : ''}</div>
              ${x.ai_comment ? `<div class="s" style="margin-top:4px;font-style:italic"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 8V4H8" /> <rect width="16" height="12" x="4" y="8" rx="2" /> <path d="M2 14h2" /> <path d="M20 14h2" /> <path d="M15 13v2" /> <path d="M9 13v2" /> </svg> ${esc(x.ai_comment)}</div>` : ''}
              ${x.store_id ? `<button class="mchip" style="margin-top:6px" onclick="event.stopPropagation();proposeMoveForStore('${x.store_id}')">Предложить перенос</button>` : ''}
            </div>
          </div>`).join('');
      } else {
        html += `<div class="empty" style="padding:12px 16px">Критических просадок нет — сектор в ритме</div>`;
      }

      box.innerHTML = html;
    }

    // Общий примитив строки-бара — используется и на «Точки» (сегодня),
    // и на «Тренд» (месячный план/прогноз, сектор и по точкам).
    function svBarRowHTML(label, fact, plan) {
      const p = plan > 0 ? Math.round((fact / plan) * 100) : (fact > 0 ? 100 : 0);
      return `<div class="sv-bar-row">
        <div>${esc(label)}</div>
        <div class="sv-bar-track"><div class="sv-bar-fill" style="width:${Math.min(100,p)}%;background:${svBarColor(p)}"></div></div>
        <div style="text-align:right">${fact||0}/${plan||0}</div>
      </div>`;
    }

    // «Ещё метрики» на строках-барах (не на сетке .mt-cell — см. .sv-extra
    // в styles.css) — toggleMonthExtra() из 06b-plans-bfq.js переиспользуется
    // как есть, он только дёргает класс .open и текст кнопки.
    function svExtraToggleHTML(idPrefix, rowsHtml) {
      return `<div class="mt-more">
        <button type="button" class="sv-toggle" onclick="toggleMonthExtra('${idPrefix}', this)">Ещё метрики ▾</button>
        <div class="sv-extra" id="${idPrefix}">${rowsHtml}</div>
      </div>`;
    }

    function renderSvStores(d) {
      const box = document.getElementById('svStoresBody');
      if (!box) return;
      box.innerHTML = (d.stores || []).map((s, idx) => {
        const t = s.today || {};
        const o = Number(t.overall) || 0;
        const badge = svTone(o);
        const bars = [
          { l: 'SIM', f: t.sim, p: t.plan_sim },
          { l: 'MNP', f: t.mnp, p: t.plan_mnp },
          { l: 'ПА', f: t.pa, p: t.plan_pa }
        ].map(b => svBarRowHTML(b.l, b.f, b.p)).join('');
        // Остальные метрики (кроме уже показанных SIM/MNP/ПА) — под «Ещё метрики»
        const shown = new Set(['sim', 'mnp', 'pa']);
        const extraIds = METRICS.map(m => m.id).filter(id => !shown.has(id));
        const extraRows = extraIds.map(id => {
          const v = (t.metrics && t.metrics[id]) || {};
          return svBarRowHTML(metricLabel(id), v.fact || 0, v.plan || 0);
        }).join('');
        const staff = (s.staff || []).map(x => x.name.split(' ')[0]).join(', ') || '—';
        const alerts = (s.alerts || []).map(a => `<div style="font-size:11px;color:#FF9F0A;margin-top:4px">• ${esc(a)}</div>`).join('');
        return `<div class="sv-store" style="--sc:${s.color || '#8B5CF6'}">
          <div class="sv-store-head">
            <div>
              <div class="sv-store-name">${esc(s.name)}</div>
              <div class="sv-store-org">${esc(s.org_name || '')}</div>
              <div class="sv-store-code">${s.code || ''} · на смене ${s.staff_count || 0}</div>
            </div>
            <div class="sv-badge ${badge}">${o}%</div>
          </div>
          <div class="sv-bars">${bars}</div>
          ${svExtraToggleHTML('svst-' + idx, extraRows)}
          <div class="sv-staff"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <path d="M16 3.128a4 4 0 0 1 0 7.744" /> <path d="M22 21v-2a4 4 0 0 0-3-3.87" /> <circle cx="9" cy="7" r="4" /> </svg> ${esc(staff)}</div>
          ${alerts}
        </div>`;
      }).join('') || '<div class="empty">Нет точек — сектор не назначен</div>';
    }

    function renderSvPeople(d) {
      const box = document.getElementById('svPeopleBody');
      if (!box) return;
      box.innerHTML = (d.top_employees || []).map((e, i) => `
        <div class="sv-rank">
          <div class="pos ${i < 3 ? 'gold' : ''}">${e.rank || i + 1}</div>
          <div class="body">
            <div class="name">${esc(e.full_name)}</div>
            <div class="org">${esc(e.org_name || '')}</div>
            <div class="sub">SIM ${e.sim} · MNP ${e.mnp} · ПА ${e.pa} · score ${e.score}</div>
          </div>
        </div>`).join('') || '<div class="empty">Нет продаж за период</div>';
    }

    // Месячный план: сектор целиком или одна точка. values — {sim:{...},...},
    // valueKey — 'fact' для «выполнено сейчас», 'total' для «прогноз на конец месяца».
    function svMonthPlanBlock(idPrefix, values, valueKey) {
      const ids = METRICS.map(m => m.id);
      const main = ids.slice(0, 6);
      const extra = ids.slice(6);
      const rowsFor = (list) => list.map(id => {
        const v = values[id] || {};
        return svBarRowHTML(metricLabel(id), v[valueKey] || 0, v.plan || 0);
      }).join('');
      return `<div class="sv-bars">${rowsFor(main)}</div>${svExtraToggleHTML(idPrefix, rowsFor(extra))}`;
    }

    function renderSvTrend(d) {
      const box = document.getElementById('svTrendBody');
      if (!box) return;
      const net = d.network || {};
      const netMonth = net.month || {};
      const netFactPct = pctOfMetric(netMonth.metrics);
      const netForecastPct = pctOfMetricForecast(netMonth.forecast);

      let html = `
        <div class="sv-chart">
          ${sparklineSVG(d.trend || [], 'units')}
          <div class="sv-chart-legend">
            <span><i style="background:#8B5CF6"></i>Units / день</span>
            <span>с ${d.from || ''} по ${d.date || ''}</span>
          </div>
        </div>
      `;

      html += `<div class="sv-section">Месячный план — весь сектор <span>· выполнено сейчас: ${netFactPct}%</span></div>`;
      html += `<div class="sv-store" style="--sc:#8B5CF6">${svMonthPlanBlock('svmp-net', netMonth.metrics || {}, 'fact')}</div>`;

      html += `<div class="sv-section">Прогноз на конец месяца — сектор <span>· ожидается: ${netForecastPct}%</span></div>`;
      html += `<div class="sv-store" style="--sc:#8B5CF6">${svMonthPlanBlock('svfc-net', netMonth.forecast || {}, 'total')}</div>`;

      html += `<div class="sv-section">Прогноз по точкам <span>· план на месяц каждой точки</span></div>`;
      html += (d.stores || []).map((s, idx) => {
        const fc = (s.month && s.month.forecast) || {};
        const overallFc = pctOfMetricForecast(fc);
        return `<div class="sv-store" style="--sc:${s.color || '#8B5CF6'}">
          <div class="sv-store-head">
            <div>
              <div class="sv-store-name">${esc(s.name)}</div>
              <div class="sv-store-org">${esc(s.org_name || '')}</div>
            </div>
            <div class="sv-badge ${svTone(overallFc)}">${overallFc}%</div>
          </div>
          ${svMonthPlanBlock('svfcs-' + idx, fc, 'total')}
        </div>`;
      }).join('') || '<div class="empty">Нет точек</div>';

      box.innerHTML = html;
    }

    function n0(v) { return Number(v) || 0; }
    // Метрики в разных единицах (штуки SIM vs рубли Аксессуары) — суммировать
    // сырые значения через все 15 нельзя, это бессмысленное число. Общий %
    // считаем как СРЕДНЕЕ уже готовых процентов по каждой метрике — тот же
    // принцип, что storeCard.today.overall (среднее simPct/mnpPct/paPct).
    function avgPct(getPct) {
      const vals = METRICS.map(m => n0(getPct(m.id)));
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    }
    function pctOfMetric(metrics) {
      if (!metrics) return 0;
      return avgPct(id => (metrics[id] || {}).pct);
    }
    function pctOfMetricForecast(forecast) {
      if (!forecast) return 0;
      return avgPct(id => (forecast[id] || {}).pct);
    }


    // init
    bootApp();

