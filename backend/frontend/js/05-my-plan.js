/* 05-my-plan.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== MY PLAN + BIND =====
    function ringSVG(pct) {
      const r = 36;
      const c = 2 * Math.PI * r;
      const p = Math.max(0, Math.min(100, Number(pct) || 0));
      const offset = c - (p / 100) * c;
      const tone = pctTone(p);
      return `
        <div class="lk-ring">
          <svg viewBox="0 0 88 88">
            <circle class="bg" cx="44" cy="44" r="${r}" />
            <circle class="fg ${tone}" cx="44" cy="44" r="${r}"
              stroke-dasharray="${c}" stroke-dashoffset="${offset}" />
          </svg>
          <div class="lk-ring-val">${Math.round(p)}%<small>план</small></div>
        </div>`;
    }

    function metricCard(label, fact, plan) {
      const f = Number(fact) || 0;
      const p = Number(plan) || 0;
      const percent = p > 0 ? Math.round((f / p) * 100) : (f > 0 ? 100 : 0);
      const w = Math.min(percent, 100);
      return `
        <div class="lk-metric">
          <div class="lm-label">${label}</div>
          <div class="lm-val">${f}</div>
          <div class="lm-plan">из ${p} · ${percent}%</div>
          <div class="lm-bar"><i class="${pctTone(percent)}" style="width:${w}%"></i></div>
        </div>`;
    }

    // roleLabel() — общий хелпер из 01-core.js

    async function loadMyPlan() {
      const bindSec = document.getElementById('myBindSection');
      const root = document.getElementById('lkRoot');
      if (root) {
        root.style.display = 'block';
        ['lkProfile','lkShift','lkInsight','lkToday','lkMonth','lkWeek','lkBfq','lkGamification','lkActions']
          .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<div class="skeleton" style="margin-bottom:10px"></div>';
          });
      }

      const user = tgUser();
      if (user?.photo_url) {
        document.getElementById('userAvatar').innerHTML = `<img src="${user.photo_url}" alt="">`;
      } else if (user?.first_name) {
        document.getElementById('userAvatar').textContent = user.first_name[0];
      }

      try {
        const meRes = await fetch(API + '/me', { headers: authHeaders() });
        if (meRes.ok) me = await meRes.json();
        else me = null;
      } catch {
        me = null;
      }

      // employee_id может быть в разных полях; bound:false = не привязан
      const empId = (me && me.bound !== false)
        ? (me.employee_id || me.id || null)
        : null;

      if (!empId) {
        if (root) root.style.display = 'none';
        if (bindSec) bindSec.style.display = 'block';
        try {
          const empRes = await fetch(API + '/employees', { headers: authHeaders() });
          employees = await empRes.json();
          const unbound = (employees || []).filter(e => !e.telegram_id || Number(e.telegram_id) === 0);
          const list = unbound.length ? unbound : (employees || []);
          document.getElementById('bindEmployee').innerHTML =
            list.map(e => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('');
        } catch (_) {}
        return;
      }

      if (bindSec) bindSec.style.display = 'none';
      if (root) root.style.display = 'block';

      const today = todayMoscow();
      const month = today.slice(0, 7);

      // Параллельная загрузка
      const [dayRes, progRes, monthSchRes, bfqRes, monthPlanRes] = await Promise.allSettled([
        fetch(API + '/me/day', { headers: authHeaders() }),
        fetch(API + '/employee/progress/' + empId + '?date=' + today, { headers: authHeaders() }),
        fetch(API + '/schedules/month?month=' + month, { headers: authHeaders() }),
        fetch(API + '/bfq?month=' + month, { headers: authHeaders() }),
        fetch(API + '/plans/employees/month?month=' + month, { headers: authHeaders() })
      ]);

      async function jsonOk(settled) {
        if (settled.status !== 'fulfilled' || !settled.value.ok) return null;
        try { return await settled.value.json(); } catch { return null; }
      }

      const dayData = await jsonOk(dayRes);
      const progData = await jsonOk(progRes);
      const monthSch = await jsonOk(monthSchRes);
      const bfqData = await jsonOk(bfqRes);
      const monthPlansRaw = await jsonOk(monthPlanRes);
      // API: { month, rows, totals }
      const monthPlans = Array.isArray(monthPlansRaw)
        ? monthPlansRaw
        : (monthPlansRaw?.rows || monthPlansRaw?.items || []);

      // --- Профиль ---
      const fullName = me.full_name || user?.first_name || 'Сотрудник';
      const role = me.role || 'employee';
      const photo = user?.photo_url;
      const shift = dayData?.shift || null;
      const storeName = shift?.store_name || shift?.store_id || null;
      const storeId = shift?.store_id;
      const color = storeColor(storeId);

      document.getElementById('lkProfile').innerHTML = `
        <div class="lk-hero">
          <div class="lk-hero-top">
            <div class="lk-avatar">
              ${photo ? `<img src="${photo}" alt="">` : (fullName[0] || 'T')}
            </div>
            <div>
              <div class="lk-name">${fullName}</div>
              <span class="lk-role ${role === 'manager' || role === 'admin' ? 'manager' : ''}">${roleLabel(role)}</span>
            </div>
          </div>
          <div class="lk-hero-meta">
            ${storeName ? `<div class="lk-pill">📍 <strong>${storeName}</strong></div>` : `<div class="lk-pill">Сегодня выходной</div>`}
            ${shift?.shift_text ? `<div class="lk-pill">🕒 <strong>${shift.shift_text}</strong>${shift.hours ? ' · ' + shift.hours + 'ч' : ''}</div>` : ''}
            <div class="lk-pill">📅 <strong>${formatDateRu(today)}</strong></div>
          </div>
        </div>`;

      // --- Кольцо прогресса дня ---
      const tot = dayData?.total || progData?.total || {};
      const dayPct = tot.pct != null ? tot.pct : (
        tot.plan > 0 ? Math.round((tot.fact / tot.plan) * 100) : 0
      );

      // 11: на выходной кольцо «0% план / Нет смены» дублирует и pill
      // «Сегодня выходной» в шапке профиля, и текст блока «Смена» ниже —
      // три места об одном и том же. На выходной просто не рендерим кольцо.
      document.getElementById('lkToday').innerHTML = storeName ? `
        <div class="section-title" style="margin-bottom:8px">Сегодня</div>
        <div class="lk-ring-card">
          ${ringSVG(dayPct)}
          <div class="lk-ring-info">
            <div class="lk-ring-title">Смена на точке</div>
            <div class="lk-ring-sub">Выполнение дневного плана по ключевым метрикам.</div>
            <div class="lk-ring-store">
              <span class="lk-dot" style="background:${color}"></span>
              ${storeName}${shift?.shift_text ? ' · ' + shift.shift_text : ''}
            </div>
          </div>
        </div>` : '';

      // --- Месяц (22: формат «БЛОК GI / Товарка / Ростелеком / Кредиты» —
      // тот же, что у карточки точки на «План» (loadPlanDay, 04-schedule.js),
      // а не числовая сетка «Планы и факт за месяц» — там речь про сеть,
      // здесь про себя, и факт/план в процентах читается понятнее ) ---
      let monthHtml = '';
      const myMonth = (monthPlans || []).find(p =>
        String(p.employee_id) === String(empId) || String(p.id) === String(empId)
      ) || null;

      if (myMonth) {
        const plan = myMonth.plan || {};
        const fact = myMonth.fact || {};
        const GROUPS = [
          { label: 'Блок GI', rows: [['sim'], ['mnp'], ['pa'], ['hb']] },
          { label: 'Товарка', rows: [['combo'], ['phones'], ['accessories'], ['insurance']] },
          { label: 'Ростелеком', rows: [['wink'], ['shpd'], ['focus']] },
          { label: 'Кредиты', rows: [['credit_request', 'Заявка'], ['credit_issued', 'Выданный']] }
        ];
        monthHtml = `
          <div class="mt-card">
            <div class="mt-card-head">
              <div>
                <div class="mt-name">Месяц ${month}</div>
                <div class="mt-meta">Смен: ${myMonth.shifts || 0} · осталось: ${myMonth.remaining_shifts || 0}</div>
              </div>
            </div>
            ${GROUPS.map(g => `
              <div class="block-label">${g.label}</div>
              ${g.rows.map(([id, label]) => progressHTML(label || metricLabel(id), fact[id], plan[id])).join('')}
            `).join('')}
          </div>`;
      } else {
        monthHtml = `
          <div class="mt-card">
            <div class="mt-name" style="margin-bottom:8px">Месяц ${month}</div>
            <div class="empty" style="padding:8px 0">Месячный план подтянется, когда будут данные</div>
          </div>`;
      }
      document.getElementById('lkMonth').innerHTML =
        `<div class="section-title" style="margin-bottom:8px">Прогресс за месяц</div>` + monthHtml;

      // --- Неделя (график) ---
      const schedules = Array.isArray(monthSch)
        ? monthSch
        : (monthSch?.items || monthSch?.schedules || []);
      const mySch = schedules.filter(s => String(s.employee_id) === String(empId));
      const byDate = {};
      mySch.forEach(s => {
        const d = String(s.work_date || s.date || '').slice(0, 10);
        if (d) byDate[d] = s;
      });

      // 7 дней вокруг сегодня (сегодня ±3, или текущая неделя пн-вс)
      const base = new Date(today + 'T12:00:00');
      const weekDays = [];
      // показываем 7 дней начиная с понедельника текущей недели
      const dow = base.getDay(); // 0 вс
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      for (let i = 0; i < 7; i++) {
        const dt = new Date(base);
        dt.setDate(base.getDate() + mondayOffset + i);
        const iso = dt.toISOString().slice(0, 10);
        weekDays.push(iso);
      }
      // если сегодня не в диапазоне — сдвиг: просто 7 дней от сегодня-3
      if (!weekDays.includes(today)) {
        weekDays.length = 0;
        for (let i = -3; i <= 3; i++) {
          const dt = new Date(base);
          dt.setDate(base.getDate() + i);
          weekDays.push(dt.toISOString().slice(0, 10));
        }
      }

      const wdNames = ['вс','пн','вт','ср','чт','пт','сб'];
      document.getElementById('lkWeek').innerHTML = `
        <div class="section-title" style="margin-bottom:8px">Моя неделя</div>
        <div class="lk-week">
          ${weekDays.map(iso => {
            const d = new Date(iso + 'T12:00:00');
            const sch = byDate[iso];
            const isToday = iso === today;
            const col = sch ? storeColor(sch.store_id) : 'var(--surface-2)';
            return `
              <div class="lk-day ${isToday ? 'today' : ''} ${sch ? '' : 'off'}">
                <div class="wd">${wdNames[d.getDay()]}</div>
                <div class="dn">${d.getDate()}</div>
                <div class="st" style="background:${col}" title="${sch ? (sch.store_name || sch.store_id || '') : 'вых'}"></div>
              </div>`;
          }).join('')}
        </div>
        <div style="font-size:11px;color:var(--hint);margin:4px 0 12px">
          Цвет точки = смена · серый = выходной
        </div>`;

      // --- BFQ ---
      const bfqList = Array.isArray(bfqData) ? bfqData : (bfqData?.items || bfqData?.employees || []);
      const myBfq = bfqList.find(e =>
        String(e.employee_id) === String(empId) || String(e.id) === String(empId)
      );
      const sorted = [...bfqList].sort((a, b) =>
        (Number(b.total ?? b.bfq ?? 0) - Number(a.total ?? a.bfq ?? 0))
      );
      const rank = myBfq
        ? sorted.findIndex(e =>
            String(e.employee_id) === String(empId) || String(e.id) === String(empId)
          ) + 1
        : null;
      const score = myBfq ? (myBfq.total ?? myBfq.bfq ?? '—') : '—';

      document.getElementById('lkBfq').innerHTML = `
        <div class="lk-bfq-card" onclick="switchPage('bfq')" style="cursor:pointer">
          <div>
            <div class="bfq-label">BFQ за месяц</div>
            <div class="bfq-score">${score}</div>
          </div>
          <div class="bfq-rank">
            ${rank ? `#${rank} в сети` : 'Нет рейтинга'}
            <div style="font-size:11px;opacity:0.6;margin-top:4px">открыть →</div>
          </div>
        </div>`;

      // --- Быстрые действия ---
      document.getElementById('lkActions').innerHTML = `
        <div class="section-title" style="margin-bottom:8px">Действия</div>
        <div class="lk-actions-grid">
          <button class="lk-action" onclick="openAddSale(${empId})">
            <div class="la-ico">➕</div>
            <div class="la-title">Продажа</div>
            <div class="la-sub">Внести метрики</div>
          </button>
          <button class="lk-action" onclick="switchPage('schedule')">
            <div class="la-ico">📅</div>
            <div class="la-title">График</div>
            <div class="la-sub">Месяц целиком</div>
          </button>
          <button class="lk-action" onclick="switchPage('plan')">
            <div class="la-ico">🎯</div>
            <div class="la-title">План дня</div>
            <div class="la-sub">Все точки</div>
          </button>
          <button class="lk-action" onclick="startTutorial('employee')">
            <div class="la-ico">🎓</div>
            <div class="la-title">Обучение</div>
            <div class="la-sub">Как пользоваться</div>
          </button>
          <button class="lk-action" onclick="openShiftSession()">
            <div class="la-ico">🟢</div>
            <div class="la-title">Смена</div>
            <div class="la-sub">Открыть / закрыть</div>
          </button>
          <button class="lk-action" onclick="openQuickSale()">
            <div class="la-ico">⚡</div>
            <div class="la-title">Быстрый ввод</div>
            <div class="la-sub">«две симки mnp»</div>
          </button>
          <button class="lk-action" onclick="switchPage('live')">
            <div class="la-ico">🗺</div>
            <div class="la-title">Сеть live</div>
            <div class="la-sub">Все точки</div>
          </button>
          <button class="lk-action" onclick="historyEmployeeFilter=${empId};switchPage('history')">
            <div class="la-ico">🧾</div>
            <div class="la-title">История продаж</div>
            <div class="la-sub">Твои продажи</div>
          </button>
        </div>`;

      // v13: сессия смены + инсайт + геймификация
      loadShiftAndInsight(empId);
    }

    async function bindMe() {
      const user = tgUser();
      if (!user?.id) {
        toast('Откройте из Telegram', 'err');
        return;
      }
      const employeeId = document.getElementById('bindEmployee').value;
      try {
        const res = await fetch(API + '/me/bind', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({ telegram_id: user.id, employee_id: Number(employeeId) })
        });
        if (!res.ok) throw new Error('bind fail');
        me = await res.json();
        toast('Привязано', 'ok');
        loadMyPlan();
      } catch (e) {
        toast('Ошибка привязки', 'err');
      }
    }

