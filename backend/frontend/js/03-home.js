/* 03-home.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== HOME / MY DAY + DASH =====
    async function loadMyDay() {
      const box = document.getElementById('myDayBody');
      if (!box) return;
      const user = tgUser();
      if (!user?.id) {
        box.innerHTML = '<div class="empty">Открой из Telegram, чтобы видеть свой день</div>';
        document.getElementById('homeTodaySwipe')?._swipeRefreshHeight?.();
        return;
      }
      try {
        const res = await fetch(API + '/me/day', { headers: authHeaders() });
        const d = await res.json();
        if (!d.bound) {
          box.innerHTML = `
            <div class="empty" style="text-align:left;padding:8px 0">Аккаунт не привязан</div>
            <button class="btn-main" onclick="switchPage('my')">Привязать себя</button>`;
          document.getElementById('homeTodaySwipe')?._swipeRefreshHeight?.();
          return;
        }
        const shift = d.shift;
        const tot = d.total || {};
        const pr = d.progress || {};
        const headEl = document.getElementById('myDayStoreHead');
        if (headEl) {
          headEl.innerHTML = shift
            ? `<div style="padding:0 16px 10px">
                <div style="font-size:15px;font-weight:700">${esc(shift.store_code || shift.store_name || '')}</div>
                ${shift.store_address ? `<div style="font-size:12px;color:var(--hint);margin-top:2px">${esc(shift.store_address)}</div>` : ''}
              </div>`
            : `<div style="padding:0 16px 10px"><div style="font-size:15px;font-weight:700">Выходной</div></div>`;
        }
        box.innerHTML = `
          <div class="progress-block">
            ${shift ? `
              <div class="row" style="border:none;padding:0 0 10px">
                <div class="row-icon">📍</div>
                <div class="row-body">
                  <div class="row-title">${shift.store_name || 'Точка'}</div>
                  <div class="row-sub">${shift.shift_text || ''} · ${shift.hours || ''}ч</div>
                </div>
                <div class="row-value">${tot.pct || 0}%</div>
              </div>` : `
              <div class="empty" style="text-align:left;padding:0 0 10px">Сегодня выходной / нет в графике</div>`}
            ${Object.keys(pr).filter(m => (pr[m]?.plan || 0) > 0).map(m => {
              const x = pr[m] || { fact: 0, plan: 0, pct: 0 };
              return progressHTML(metricShort(m), x.fact, x.plan);
            }).join('')}
            <button class="btn-main" style="margin-top:8px" onclick="openAddSale()">+ Продажа</button>
          </div>
          ${myTasksHTML(d.tasks)}`;
      } catch (e) {
        box.innerHTML = '<div class="empty">Не удалось загрузить «Мой день»</div>';
      }
      document.getElementById('homeTodaySwipe')?._swipeRefreshHeight?.();
    }

    /* 18.4 — задачи, назначенные менеджером (Command Center → create_task),
       на единственном персональном экране сотрудника. */
    function myTasksHTML(tasks) {
      if (!Array.isArray(tasks) || !tasks.length) return '';
      return `
        <div class="section-title" style="padding:12px 0 8px">Мои задачи</div>
        ${tasks.map(t => `
          <div class="row" style="cursor:default">
            <div class="row-icon">📋</div>
            <div class="row-body">
              <div class="row-title">${esc(t.title)}</div>
              <div class="row-sub">${t.store_name ? esc(t.store_name) + ' · ' : ''}${t.status === 'in_progress' ? 'В работе' : 'Открыта'}${t.due_at ? ' · до ' + new Date(t.due_at).toLocaleString('ru') : ''}</div>
            </div>
            <button class="mchip" onclick="completeMyTask(${t.id})">Готово</button>
          </div>`).join('')}`;
    }

    async function completeMyTask(id) {
      try {
        const res = await fetch(API + '/tasks/' + id + '/status', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({ status: 'done' })
        });
        if (!res.ok) throw new Error('fail');
        toast('Задача выполнена', 'ok');
        loadMyDay();
      } catch (e) {
        toast('Не удалось отметить задачу', 'err');
      }
    }

    // ===== COMMAND CENTER (14.5) =====
    // Health + просадки в одном виджете на главной — вместо того чтобы
    // управляющий сам собирал это из /supervisor и /live по отдельности.
    // /supervisor/health для того и заведён ("короткий срез для виджетов"),
    // просто раньше не был подключён ни к одному экрану.
    function commandCenterTone(health) {
      if (health >= 75) return 'good';
      if (health >= 45) return 'mid';
      return 'bad';
    }

    async function loadCommandCenter() {
      const section = document.getElementById('commandCenterSection');
      const box = document.getElementById('commandCenterBody');
      if (!section || !box) return;
      if (!canViewAnalytics()) {
        section.style.display = 'none';
        return;
      }
      section.style.display = '';
      try {
        const res = await fetch(API + '/supervisor/health?_=1' + orgQueryParam(), { headers: authHeaders() });
        if (!res.ok) throw new Error('fail');
        const d = await res.json();
        const health = Number(d.health) || 0;
        const tone = commandCenterTone(health);
        const pace = Number(d.pace_delta) || 0;
        const paceText = (pace >= 0 ? '+' : '') + pace + '% к темпу дня';
        const drops = Array.isArray(d.drops) ? d.drops : [];

        box.innerHTML = `
          <div class="cc-row">
            <div class="cc-health ${tone}">${health}</div>
            <div class="cc-meta">
              <div class="cc-line"><b>${d.overall_pct || 0}%</b> план дня</div>
              <div class="cc-line cc-${pace >= 0 ? 'up' : 'down'}">${paceText}</div>
            </div>
            <button class="row-chevron" style="background:none;border:none;font-size:20px;color:var(--hint)" onclick="switchPage('command-center')">›</button>
          </div>
          ${drops.length
            ? drops.slice(0, 3).map(x => `
              <div class="sv-drop ${x.severity === 'critical' ? '' : 'warn'}" style="margin:8px 0 0">
                <div class="ico">${x.severity === 'critical' ? '🚨' : '⚠️'}</div>
                <div style="flex:1">
                  <div class="t">${esc(x.store_name || 'Точка')}</div>
                  <div class="s">${esc(x.message || '')}</div>
                  ${x.ai_comment ? `<div class="s" style="margin-top:4px;font-style:italic">🤖 ${esc(x.ai_comment)}</div>` : ''}
                  ${x.store_id ? `<button class="mchip" style="margin-top:6px" onclick="event.stopPropagation();proposeMoveForStore('${x.store_id}')">Предложить перенос</button>` : ''}
                </div>
              </div>`).join('')
            : '<div class="empty" style="padding:10px 0 0">Критических просадок нет — сеть в ритме</div>'
          }`;
      } catch (e) {
        section.style.display = 'none';
      }
    }

    async function loadHome() {
      document.getElementById('headerDate').textContent = formatDateRu(todayMoscow());

      // Приветствие
      const user = tgUser();
      const firstName = me?.full_name?.split(' ')[1] || me?.full_name?.split(' ')[0] || user?.first_name || 'команда';
      const streak = Number(localStorage.getItem('t2_streak') || 0);
      const lastSaleDay = localStorage.getItem('t2_last_sale_day') || '';
      const today = todayMoscow();
      let showStreak = streak;
      if (lastSaleDay && lastSaleDay !== today) {
        // streak не сбрасываем на главной — только показываем
      }
      const greetEl = document.getElementById('greetingCard');
      if (greetEl) {
        greetEl.innerHTML = `
          <div class="greet-card">
            <div class="greet-hi">${greetingByHour()}</div>
            <div class="greet-name">${firstName}</div>
            <div class="greet-badges">
              <span class="greet-badge">T2 Sales v${APP_VERSION}</span>
              ${showStreak > 0 ? `<span class="greet-badge fire">🔥 ${showStreak} дн. подряд</span>` : `<span class="greet-badge">Внеси продажу — начни стрик</span>`}
              ${me?.role ? `<span class="greet-badge">${esc(roleLabel(me.role))}</span>` : ''}
            </div>
          </div>`;
      }

      loadMyDay();
      loadCommandCenter();
      initSwipePanels(document.getElementById('homeTodaySwipe'));
      try {
        const [statsRes, dashRes] = await Promise.all([
          fetch(API + '/stats/daily?date=' + today + orgQueryParam(), { headers: authHeaders() }).catch(() => null),
          fetch(API + '/dashboard?_=1' + orgQueryParam(), { headers: authHeaders() }).catch(() => null)
        ]);
        const stats = (statsRes && statsRes.ok) ? await statsRes.json() : [];
        const list = Array.isArray(stats) ? stats : [];

        const t = list.reduce((a, s) => ({
          sim: a.sim + (+s.sim || 0),
          mnp: a.mnp + (+s.mnp || 0),
          pa: a.pa + (+s.pa || 0),
          combo: a.combo + (+s.combo || 0),
          phones: a.phones + (+s.phones || 0),
          accessories: a.accessories + (+s.accessories || 0)
        }), { sim: 0, mnp: 0, pa: 0, combo: 0, phones: 0, accessories: 0 });

        const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        setTxt('hSim', t.sim);
        setTxt('hMnp', t.mnp);
        setTxt('hPa', t.pa);
        setTxt('hCombo', t.combo);
        setTxt('hPhones', t.phones);
        setTxt('hAcc', t.accessories);

        // Пульс сети
        const units = (t.sim || 0) + (t.mnp || 0) + (t.pa || 0) + (t.combo || 0);
        const pulse = document.getElementById('networkPulse');
        if (pulse) {
          pulse.innerHTML = `
            <div class="pulse-row">
              <div class="pulse-chip">
                <div class="pc-l">Единицы</div>
                <div class="pc-v">${units}</div>
              </div>
              <div class="pulse-chip">
                <div class="pc-l">${metricShort('phones')} ₽</div>
                <div class="pc-v">${Number(t.phones || 0).toLocaleString('ru-RU')}</div>
              </div>
              <div class="pulse-chip">
                <div class="pc-l">${metricShort('accessories')} ₽</div>
                <div class="pc-v">${Number(t.accessories || 0).toLocaleString('ru-RU')}</div>
              </div>
            </div>`;
        }
        document.getElementById('homeTodaySwipe')?._swipeRefreshHeight?.();

        const box = document.getElementById('homeTop');
        if (box) {
          if (dashRes && dashRes.ok) {
            const dash = await dashRes.json();
            const leaders = dash.top || dash.top7 || dash.leaders || dash.employees || [];
            if (!leaders.length) {
              box.innerHTML = '<div class="empty">Нет данных за 7 дней</div>';
            } else {
              box.innerHTML = leaders.slice(0, 7).map((e, i) => {
                const total = (+e.sim || 0) + (+e.mnp || 0) + (+e.pa || 0) + (+e.combo || 0);
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
                return `
                <button class="row" onclick="openEmployeeCard(${e.id || e.employee_id})">
                  <div class="row-icon">${medal}</div>
                  <div class="row-body">
                    <div class="row-title">${esc(e.full_name)}</div>
                    <div class="row-sub">SIM ${e.sim || 0} · MNP ${e.mnp || 0} · ПА ${e.pa || 0}</div>
                  </div>
                  <div class="row-value">${total}</div>
                  <div class="row-chevron">›</div>
                </button>`;
              }).join('');
            }
          } else {
            box.innerHTML = '<div class="empty">Топ за 7 дней недоступен</div>';
          }
        }
      } catch (e) {
        console.error(e);
      }
    }

    function bumpStreak() {
      const today = todayMoscow();
      const last = localStorage.getItem('t2_last_sale_day') || '';
      let streak = Number(localStorage.getItem('t2_streak') || 0);
      if (last === today) return streak;
      const yday = (() => {
        const d = new Date(today + 'T12:00:00');
        d.setDate(d.getDate() - 1);
        return d.toISOString().slice(0, 10);
      })();
      streak = last === yday ? streak + 1 : 1;
      localStorage.setItem('t2_streak', String(streak));
      localStorage.setItem('t2_last_sale_day', today);
      return streak;
    }

    function openAbout() {
      haptic('light');
      document.getElementById('modalTitle').textContent = 'О приложении';
      document.getElementById('modalBody').innerHTML = `
        <div class="about-ver">T2 Sales</div>
        <div style="font-size:13px;color:var(--hint);margin-bottom:14px">версия ${APP_VERSION} · Railway · МСК</div>
        <div class="about-block">
          <b>v13 — операционное ядро</b><br>
          • Смена-сессия (open/close + гео + самоотчёт)<br>
          • Быстрый ввод: «две симки mnp»<br>
          • Офлайн-очередь продаж<br>
          • Live-карта сети · инсайты · геймификация<br>
          • Умные алерты · what-if · прогноз
        </div>
        <div class="about-block">
          <b>v14 — аналитика и масштаб</b><br>
          • Кабинет супервайзера (health, просадки, тренды)<br>
          • Кастомные метрики · PNG-отчёты в чат<br>
          • Heatmap / forecast / announcements<br>
          • Доли точек: 55% / 25% / 20%
        </div>
        <div class="about-block">
          <b>v12–13.3</b><br>
          • Личный кабинет · мульти-метрики · BFQ<br>
          • Планы месяца (все метрики + архив)<br>
          • Касса: Δ = факт − (1С + 2000)<br>
          • Промокоды РТК · поддержка · роли
        </div>
        <div class="about-block">
          <b>Стек</b><br>
          Telegram Mini App · Node.js · Fastify · PostgreSQL · Grammy · Railway
        </div>
        <div class="about-block">
          <b>Точки</b><br>
          Космонавтов 20А · Калинина 2 · Калинина 11
        </div>
        <button class="btn-main" onclick="startTutorial('employee');closeModal()">Пройти обучение</button>
        <button class="btn-main" style="margin-top:8px;background:var(--surface-2);color:var(--text)" onclick="closeModal()">Закрыть</button>
      `;
      if (typeof openModal === 'function') openModal();
      else document.getElementById('overlay')?.classList.add('show');
    }

