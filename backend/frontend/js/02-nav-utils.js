/* 02-nav-utils.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== Utils =====
    // todayMoscow() живёт в 01-core.js — она нужна там уже на верхнем уровне
    // (scheduleMonth/planMonth), а порядок подключения скриптов этого не ждёт.
    function formatDateRu(iso) {
      try {
        const [y, m, d] = iso.split('-');
        return `${d}.${m}.${y}`;
      } catch { return iso; }
    }

    function toast(msg, type = '') {
      if (type === 'ok' || type === 'success') haptic('success');
      else if (type === 'err' || type === 'error') haptic('error');
      else haptic('light');
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast show ' + type;
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove('show'), 2400);
    }

    function pctTone(p) {
      if (p >= 100) return 'good';
      if (p >= 70) return 'mid';
      return 'bad';
    }

    function progressHTML(label, fact, plan) {
      const f = Number(fact) || 0;
      const p = Number(plan) || 0;
      const percent = p > 0 ? Math.round((f / p) * 100) : (f > 0 ? 100 : 0);
      const w = Math.min(percent, 100);
      return `
        <div class="progress-item">
          <div class="progress-top">
            <span class="name">${label}</span>
            <span class="val">${f} / ${p}${p ? ' · ' + percent + '%' : ''}</span>
          </div>
          <div class="bar"><i class="${pctTone(percent)}" style="width:${w}%"></i></div>
        </div>`;
    }

    function tgUser() {
      return tg?.initDataUnsafe?.user || null;
    }

    // ===== Theme =====
    function applyTheme(theme) {
      document.body.setAttribute('data-theme', theme);
      localStorage.setItem('t2_theme', theme);
      if (tg) {
        try {
          tg.setBackgroundColor(theme === 'dark' ? '#000000' : '#f2f2f7');
        } catch (_) {}
      }
    }

    function toggleTheme() {
      const cur = document.body.getAttribute('data-theme') || 'light';
      applyTheme(cur === 'light' ? 'dark' : 'light');
    }

    // ===== Navigation =====
    function switchPage(name) {
      if (!name) return;
      page = name;
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const el = document.getElementById('page-' + name);
      if (el) {
        el.classList.add('active');
      } else {
        // неизвестная вкладка — не оставляем UI пустым
        console.warn('switchPage: no page-' + name);
        document.getElementById('page-home')?.classList.add('active');
        page = 'home';
        name = 'home';
      }

      document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.page === name);
      });

      // FAB всегда доступен для быстрой продажи (кроме access-gate)
      const fab = document.querySelector('.fab');
      if (fab) fab.style.display = 'flex';

      try {
        loadPage(name);
      } catch (e) {
        console.error('loadPage', name, e);
        toast('Не удалось открыть раздел', 'err');
      }
    }

    function loadPage(name) {
      if (name === 'home') { loadHome(); }
      if (name === 'plan') { loadPlanDay(); }
      if (name === 'today') { loadTodaySchedule(); }
      if (name === 'schedule') { loadMonthSchedule(); }
      if (name === 'my') { loadMyPlan(); }
      if (name === 'bfq') { loadBFQ(); }
      if (name === 'team') { loadTeam(); }
      if (name === 'history') { loadHistory(); }
      if (name === 'monthplan') { loadMonthPlans(); }
      if (name === 'heatmap') { fillStoreSelects().then(() => loadHeatmap()); }
      if (name === 'forecast') { fillStoreSelects(); loadForecast(); const w=document.getElementById('wiDate'); if(w) w.value=todayMoscow(); }
      if (name === 'announce') loadAnnouncements();
      if (name === 'reportimg') { fillStoreSelects(); const d=document.getElementById('riDate'); if(d) d.value=todayMoscow(); }
      if (name === 'support') { loadSupportSla(); loadSupport(); }
      if (name === 'cash') { loadCash(); }
      if (name === 'access') { loadAccessRequests(); }
      if (name === 'supervisor') { loadSupervisorDash(); }
      if (name === 'live') { loadLiveMap(); }
    }

    async function refreshAll() {
      toast('Обновляю…');
      await loadPage(page);
      toast('Готово', 'ok');
    }

