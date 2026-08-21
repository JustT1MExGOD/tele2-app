/* 02-nav-utils.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== Utils =====
    // 19: кастомная аватарка. /avatars/:id отдаёт 404, если её нет —
    // пробуем загрузить через Image(), чтобы никогда не показать битую
    // картинку; при успехе подменяем содержимое элемента на <img>, при
    // неудаче не трогаем то, что там уже отрендерено (буква-инициал).
    function applyAvatarImg(elementId, employeeId) {
      if (!employeeId) return;
      const el = document.getElementById(elementId);
      if (!el) return;
      const img = new Image();
      img.onload = () => {
        el.innerHTML = `<img src="${API}/avatars/${employeeId}" alt="">`;
      };
      img.src = `${API}/avatars/${employeeId}`;
    }
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
    // Экран, с которого пришли — только для drill-in страниц вроде
    // Store/Employee Profile (открываются с конкретным id из карточки, а
    // не как обычный пункт меню «Инструменты»), которым после открытия
    // некуда вернуться, кроме как заново тыкать нижнюю вкладку.
    let previousPage = null;
    function goBack() {
      switchPage(previousPage || 'home');
    }

    function switchPage(name) {
      if (!name) return;
      previousPage = page;
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

      // FAB всегда доступен для быстрой продажи (кроме access-gate и
      // кабинета супервайзера — там нет личных продаж, чисто аналитика)
      const fab = document.querySelector('.fab');
      if (fab) fab.style.display = name.indexOf('sv-') === 0 ? 'none' : 'flex';

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
      if (name === 'netmonth') { loadNetMonth(); }
      if (name === 'heatmap') { fillStoreSelects().then(() => loadHeatmap()); }
      if (name === 'forecast') { fillStoreSelects(); loadForecast(); loadStaffingHints(); const w=document.getElementById('wiDate'); if(w) w.value=todayMoscow(); }
      if (name === 'announce') loadAnnouncements();
      if (name === 'reportimg') { fillStoreSelects(); const d=document.getElementById('riDate'); if(d) d.value=todayMoscow(); }
      if (name === 'support') { loadSupportSla(); loadSupport(); }
      if (name === 'cash') { loadCash(); }
      if (name === 'access') { loadAccessRequests(); }
      if (name === 'sv-overview' || name === 'sv-stores' || name === 'sv-people' || name === 'sv-trend') { loadSupervisorData(false); }
      if (name === 'live') { loadLiveMap(); }
      if (name === 'command-center') { loadCommandCenterPage(); }
      if (name === 'tasks') { loadTasksPage(); }
      if (name === 'store-profile') { renderStoreProfile(); }
      if (name === 'alerts') { loadAlertsPage(); }
      if (name === 'employee-profile') { renderEmployeeProfile(); }
      if (name === 'reports') { loadReportsPage(); }
      if (name === 'orgs') { loadOrgsAdmin(); }
      if (name === 'audit') { loadAuditLog(); }
    }

    async function refreshAll() {
      toast('Обновляю…');
      await loadPage(page);
      toast('Готово', 'ok');
    }

    /* Свайп между несколькими панелями в одном слоте (сейчас — «Мой день»
       ↔ «Сеть сегодня» на Главной, задел под свайп между вкладками позже).
       Тот же приём, что pull-to-refresh (07-add-sale.js): жест отслеживается
       целиком через touchmove, а не только по началу/концу — иначе
       вертикальный скролл страницы будет постоянно путаться со свайпом.
       Направление (гориз./вертик.) решается один раз в начале жеста и
       больше не пересматривается. */
    function initSwipePanels(containerEl) {
      if (!containerEl || containerEl.dataset.swipeInit) return;
      const track = containerEl.querySelector('.swipe-track');
      const panels = track ? Array.from(track.children) : [];
      const dots = Array.from(containerEl.querySelectorAll('.swipe-dots .dot'));
      if (!track || panels.length < 2) return;
      containerEl.dataset.swipeInit = '1';

      let current = 0;
      let width = containerEl.clientWidth;
      let startX = 0, startY = 0, dragging = false, horizontal = null;

      function settle(index, animate = true) {
        current = Math.max(0, Math.min(panels.length - 1, index));
        track.style.transition = animate ? 'transform 0.25s ease, height 0.25s ease' : 'none';
        track.style.transform = `translateX(${-current * width}px)`;
        // Панели разной высоты (напр. «Мой день» на выходной короче, чем в
        // рабочий день) — без этого высота трека всегда была под самую
        // высокую панель (align-items: stretch по умолчанию), и в короткой
        // панели снизу висела пустая область.
        track.style.height = panels[current].scrollHeight + 'px';
        dots.forEach((d, i) => d.classList.toggle('active', i === current));
      }

      window.addEventListener('resize', () => { width = containerEl.clientWidth; settle(current, false); });

      track.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        dragging = true;
        horizontal = null;
        width = containerEl.clientWidth;
        track.style.transition = 'none';
      }, { passive: true });

      track.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (horizontal === null) {
          if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
          horizontal = Math.abs(dx) > Math.abs(dy);
          if (!horizontal) { dragging = false; return; }
        }
        if (!horizontal) return;
        track.style.transform = `translateX(${-current * width + dx}px)`;
      }, { passive: true });

      track.addEventListener('touchend', (e) => {
        if (!dragging || !horizontal) { dragging = false; return; }
        dragging = false;
        const dx = e.changedTouches[0].clientX - startX;
        const THRESHOLD = width * 0.2;
        if (dx <= -THRESHOLD && current < panels.length - 1) settle(current + 1);
        else if (dx >= THRESHOLD && current > 0) settle(current - 1);
        else settle(current);
      }, { passive: true });

      dots.forEach((dot, i) => dot.addEventListener('click', () => settle(i)));
      settle(0, false);

      // Панели заполняются асинхронно (fetch) уже после первого settle(),
      // когда высота ещё меряется по скелетону/заглушке — вызывающий код
      // должен пересчитать высоту, когда контент реально готов.
      containerEl._swipeRefreshHeight = () => settle(current, false);
    }


