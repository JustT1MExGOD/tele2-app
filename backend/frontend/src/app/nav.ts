/**
 * 21.x (Frontend rewrite — final two files) — replacing
 * frontend/js/02-nav-utils.js file-for-file: toast, theme, page-switch
 * dispatch (the loadPage() if-chain — every one of its 29 branches now
 * calls a real typed module instead of a same-scope classic-script
 * function), and the cross-panel swipe gesture.
 *
 * loadPage()'s if-chain is left as the same explicit if-chain the original
 * had — router.ts's own header comment flags collapsing the 5 already-
 * registered pages (reports/alerts/employee-profile/store-profile/tasks) to
 * a single `hasPage()` check as a legitimate future cleanup, but that's a
 * behavior-neutral refactor beyond what this mechanical migration calls
 * for; not done here to keep this pass's risk surface to "same behavior,
 * now typed."
 *
 * previousPage stays a private module variable (only ever read/written by
 * goBack()/switchPage(), both in this same file) — unlike the state owned
 * by app/core.ts, nothing outside this module ever touches it.
 */
export {};

// 19: кастомная аватарка. /avatars/:id отдаёт 404, если её нет — пробуем
// загрузить через Image(), чтобы никогда не показать битую картинку; при
// успехе подменяем содержимое элемента на <img>, при неудаче не трогаем то,
// что там уже отрендерено (буква-инициал).
export function applyAvatarImg(elementId: string, employeeId: number): void {
  if (!employeeId) return;
  const el = document.getElementById(elementId);
  if (!el) return;
  const img = new Image();
  img.onload = () => {
    el.innerHTML = `<img src="${API}/avatars/${employeeId}" alt="">`;
  };
  img.src = `${API}/avatars/${employeeId}`;
}

// todayMoscow() живёт в app/core.ts — она нужна там уже на верхнем уровне
// (scheduleMonth/planMonth), а порядок подключения бандлов этого не ждёт.
export function formatDateRu(iso: string): string {
  try {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  } catch {
    return iso;
  }
}

export function toast(msg: string, type = ''): void {
  if (type === 'ok' || type === 'success') haptic('success');
  else if (type === 'err' || type === 'error') haptic('error');
  else haptic('light');
  const el = document.getElementById('toast') as (HTMLElement & { _t?: ReturnType<typeof setTimeout> }) | null;
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2400);
}

export function pctTone(p: number): string {
  if (p >= 100) return 'good';
  if (p >= 70) return 'mid';
  return 'bad';
}

export function progressHTML(label: string, fact: unknown, plan: unknown): string {
  const f = Number(fact) || 0;
  const p = Number(plan) || 0;
  const percent = p > 0 ? Math.round((f / p) * 100) : f > 0 ? 100 : 0;
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

export function tgUser(): { id?: number; first_name?: string; last_name?: string; username?: string; photo_url?: string } | null {
  return window.tg?.initDataUnsafe?.user || null;
}

// ===== Theme =====
export function applyTheme(theme: string): void {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('t2_theme', theme);
  if (window.tg) {
    try {
      window.tg.setBackgroundColor(theme === 'dark' ? '#000000' : '#f2f2f7');
    } catch (_) {}
  }
}

export function toggleTheme(): void {
  const cur = document.body.getAttribute('data-theme') || 'light';
  applyTheme(cur === 'light' ? 'dark' : 'light');
}

// ===== Navigation =====
// Экран, с которого пришли — только для drill-in страниц вроде Store/
// Employee Profile (открываются с конкретным id из карточки, а не как
// обычный пункт меню «Инструменты»), которым после открытия некуда
// вернуться, кроме как заново тыкать нижнюю вкладку.
let previousPage: string | null = null;
export function goBack(): void {
  switchPage(previousPage || 'home');
}

export function switchPage(name: string): void {
  if (!name) return;
  previousPage = window.page;
  window.page = name;
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const el = document.getElementById('page-' + name);
  if (el) {
    el.classList.add('active');
  } else {
    // неизвестная вкладка — не оставляем UI пустым
    console.warn('switchPage: no page-' + name);
    document.getElementById('page-home')?.classList.add('active');
    window.page = 'home';
    name = 'home';
  }

  document.querySelectorAll('.nav-item').forEach((n) => {
    n.classList.toggle('active', (n as HTMLElement).dataset.page === name);
  });

  // FAB всегда доступен для быстрой продажи (кроме access-gate и кабинета
  // супервайзера — там нет личных продаж, чисто аналитика)
  const fab = document.querySelector('.fab') as HTMLElement | null;
  if (fab) fab.style.display = name.indexOf('sv-') === 0 ? 'none' : 'flex';

  try {
    loadPage(name);
  } catch (e) {
    console.error('loadPage', name, e);
    toast('Не удалось открыть раздел', 'err');
  }
}

export function loadPage(name: string): void {
  if (name === 'home') {
    loadHome();
  }
  if (name === 'plan') {
    loadPlanDay();
  }
  if (name === 'today') {
    loadTodaySchedule();
  }
  if (name === 'schedule') {
    loadMonthSchedule();
  }
  if (name === 'my') {
    loadMyPlan();
  }
  if (name === 'bfq') {
    loadBFQ();
  }
  if (name === 'team') {
    loadTeam();
  }
  if (name === 'history') {
    loadHistory();
  }
  if (name === 'monthplan') {
    loadMonthPlans();
  }
  if (name === 'netmonth') {
    loadNetMonth();
  }
  if (name === 'heatmap') {
    fillStoreSelects().then(() => loadHeatmap());
  }
  if (name === 'forecast') {
    fillStoreSelects();
    loadForecast();
    loadStaffingHints();
    const w = document.getElementById('wiDate') as HTMLInputElement | null;
    if (w) w.value = todayMoscow();
  }
  if (name === 'announce') loadAnnouncements();
  if (name === 'reportimg') {
    fillStoreSelects();
    const d = document.getElementById('riDate') as HTMLInputElement | null;
    if (d) d.value = todayMoscow();
  }
  if (name === 'support') {
    loadSupportSla();
    loadSupport();
  }
  if (name === 'cash') {
    loadCash();
  }
  if (name === 'access') {
    loadAccessRequests();
  }
  if (name === 'sv-overview' || name === 'sv-stores' || name === 'sv-people' || name === 'sv-trend') {
    loadSupervisorData(false);
  }
  if (name === 'live') {
    loadLiveMap();
  }
  if (name === 'command-center') {
    loadCommandCenterPage();
  }
  if (name === 'tasks') {
    loadTasksPage();
  }
  if (name === 'store-profile') {
    renderStoreProfile();
  }
  if (name === 'alerts') {
    loadAlertsPage();
  }
  if (name === 'employee-profile') {
    renderEmployeeProfile();
  }
  if (name === 'reports') {
    loadReportsPage();
  }
  if (name === 'orgs') {
    loadOrgsAdmin();
  }
  if (name === 'audit') {
    loadAuditLog();
  }
}

export async function refreshAll(): Promise<void> {
  toast('Обновляю…');
  await loadPage(window.page);
  toast('Готово', 'ok');
}

/* Свайп между несколькими панелями в одном слоте (сейчас — «Мой день» ↔
   «Сеть сегодня» на Главной, задел под свайп между вкладками позже). Жест
   отслеживается целиком через touchmove, а не только по началу/концу —
   иначе вертикальный скролл страницы будет постоянно путаться со свайпом.
   Направление (гориз./вертик.) решается один раз в начале жеста и больше не
   пересматривается.
   20.14.0 (apple-design skill): переход между панелями раньше решался чисто
   по дистанции (dx >= 20% ширины) и ехал CSS transition'ом — быстрый флик
   на маленькое расстояние не переключал, а повторный захват трека ПОКА он
   ещё едет (transition ещё не кончился) считал текущее положение равным
   `-current*width`, хотя реально трек мог быть где-то на середине пути —
   видимый скачок при перехвате. Теперь решение учитывает скорость релиза, а
   сеттл — через createSpring() (app/core.ts): её можно остановить и
   перезапустить от фактического текущего X в любой момент. Высота панели
   по-прежнему меняется без анимации (спорить с высотой контента реже нужно
   перехватывать). */
export function initSwipePanels(containerEl: (HTMLElement & { dataset: DOMStringMap; _swipeRefreshHeight?: () => void }) | null): void {
  if (!containerEl || containerEl.dataset.swipeInit) return;
  const track = containerEl.querySelector('.swipe-track') as HTMLElement | null;
  const panels = track ? Array.from(track.children) as HTMLElement[] : [];
  const dots = Array.from(containerEl.querySelectorAll('.swipe-dots .dot')) as HTMLElement[];
  if (!track || panels.length < 2) return;
  containerEl.dataset.swipeInit = '1';

  const FLICK_VELOCITY = 500; // px/s
  let current = 0;
  let width = containerEl.clientWidth;
  let startX = 0,
    startY = 0,
    dragBaseX = 0,
    dragging = false,
    horizontal: boolean | null = null;
  let history: { x: number; t: number }[] = [];
  let activeSpring: { stop: () => void; getValue: () => number } | null = null;

  function currentX(): number {
    if (activeSpring) return activeSpring.getValue();
    const m = /translateX\(([-\d.]+)px\)/.exec(track!.style.transform || '');
    return m ? parseFloat(m[1]) : -current * width;
  }

  function settle(index: number, animate = true, velocity = 0): void {
    current = Math.max(0, Math.min(panels.length - 1, index));
    const target = -current * width;
    // Панели разной высоты (напр. «Мой день» на выходной короче, чем в
    // рабочий день) — без этого высота трека всегда была под самую высокую
    // панель (align-items: stretch по умолчанию), и в короткой панели снизу
    // висела пустая область.
    track!.style.height = panels[current].scrollHeight + 'px';
    dots.forEach((d, i) => d.classList.toggle('active', i === current));
    if (activeSpring) {
      activeSpring.stop();
      activeSpring = null;
    }
    if (!animate) {
      track!.style.transform = `translateX(${target}px)`;
      return;
    }
    const hasMomentum = Math.abs(velocity) > 200;
    activeSpring = createSpring({
      from: currentX(),
      velocity,
      to: target,
      damping: hasMomentum ? 0.86 : 1,
      response: 0.32,
      onUpdate: (v: number) => {
        track!.style.transform = `translateX(${v}px)`;
      },
      onSettle: () => {
        activeSpring = null;
      }
    });
  }

  window.addEventListener('resize', () => {
    width = containerEl!.clientWidth;
    settle(current, false);
  });

  track.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      // Desktop Shell (20.39) — на ≥860px "Мой день"/"Сеть сегодня"
      // сеткой рядом (styles.css, .swipe-track), не свайпом; сам
      // обработчик по-прежнему подписан (десктоп мог появиться уже после
      // инициализации, если окно ресайзится), но не должен запускать
      // расчёты под уже статичной сеткой на touch-экране такой ширины
      // (тачскрин-ноутбук/монитор) — CSS !important одно этого не даёт,
      // он только не даёт transform проявиться визуально.
      if (window.innerWidth >= 860) return;
      if (activeSpring) {
        activeSpring.stop();
        activeSpring = null;
      } // перехват на лету
      dragBaseX = currentX();
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      history = [{ x: startX, t: performance.now() }];
      dragging = true;
      horizontal = null;
      width = containerEl!.clientWidth;
    },
    { passive: true }
  );

  track.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (!dragging) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      if (horizontal === null) {
        const dx0 = x - startX,
          dy0 = y - startY;
        if (Math.abs(dx0) < 6 && Math.abs(dy0) < 6) return;
        horizontal = Math.abs(dx0) > Math.abs(dy0);
        if (!horizontal) {
          dragging = false;
          return;
        }
      }
      if (!horizontal) return;
      history.push({ x, t: performance.now() });
      if (history.length > 5) history.shift();
      track!.style.transform = `translateX(${dragBaseX + (x - startX)}px)`;
    },
    { passive: true }
  );

  track.addEventListener(
    'touchend',
    (e: TouchEvent) => {
      if (!dragging || !horizontal) {
        dragging = false;
        return;
      }
      dragging = false;
      const x = e.changedTouches[0].clientX;
      const dx = dragBaseX + (x - startX) - -current * width;
      const velocity = gestureVelocity(history, 'x');
      const THRESHOLD = width * 0.2;

      let target = current;
      if ((dx <= -THRESHOLD || velocity <= -FLICK_VELOCITY) && current < panels.length - 1) target = current + 1;
      else if ((dx >= THRESHOLD || velocity >= FLICK_VELOCITY) && current > 0) target = current - 1;
      settle(target, true, velocity);
    },
    { passive: true }
  );

  dots.forEach((dot, i) => dot.addEventListener('click', () => settle(i)));
  settle(0, false);

  // Панели заполняются асинхронно (fetch) уже после первого settle(), когда
  // высота ещё меряется по скелетону/заглушке — вызывающий код должен
  // пересчитать высоту, когда контент реально готов.
  containerEl._swipeRefreshHeight = () => settle(current, false);
}

declare global {
  interface Window {
    applyAvatarImg: typeof applyAvatarImg;
    formatDateRu: typeof formatDateRu;
    toast: typeof toast;
    pctTone: typeof pctTone;
    progressHTML: typeof progressHTML;
    tgUser: typeof tgUser;
    applyTheme: typeof applyTheme;
    toggleTheme: typeof toggleTheme;
    goBack: typeof goBack;
    switchPage: typeof switchPage;
    loadPage: typeof loadPage;
    refreshAll: typeof refreshAll;
    initSwipePanels: typeof initSwipePanels;
  }
}
window.applyAvatarImg = applyAvatarImg;
window.formatDateRu = formatDateRu;
window.toast = toast;
window.pctTone = pctTone;
window.progressHTML = progressHTML;
window.tgUser = tgUser;
window.applyTheme = applyTheme;
window.toggleTheme = toggleTheme;
window.goBack = goBack;
window.switchPage = switchPage;
window.loadPage = loadPage;
window.refreshAll = refreshAll;
window.initSwipePanels = initSwipePanels;
