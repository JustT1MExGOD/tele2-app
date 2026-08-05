/* 01-core.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      try { tg.setHeaderColor('#000000'); tg.setBackgroundColor('#f2f2f7'); } catch (_) {}
    }

    // Клиентская версия (О приложении + бейдж на главной)
    const APP_VERSION = '15.0';
    const API = window.location.origin;

    // Нужна уже ниже (scheduleMonth/planMonth) — держим здесь, а не в
    // 02-nav-utils.js, иначе первый же <script> падает ReferenceError'ом.
    function todayMoscow() {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow',
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
    }

    // Бэкенд отдаёт timestamptz как UTC ISO-строку (например открытие смены
    // в 9:55 МСК приходит как ...T06:55:00Z) — .slice(11,16) на сырой строке
    // печатал бы UTC-время как есть. Форматируем явно в Europe/Moscow.
    function timeMoscow(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(d);
    }

    function haptic(type = 'light') {
      try {
        if (!tg?.HapticFeedback) return;
        if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
        else if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
        else if (type === 'medium') tg.HapticFeedback.impactOccurred('medium');
        else tg.HapticFeedback.impactOccurred('light');
      } catch (_) {}
    }

    // Экранирование пользовательского текста перед вставкой в innerHTML.
    // full_name/comment/message приходят от других пользователей (заявки
    // на доступ, тикеты, продажи) и не должны интерпретироваться как HTML.
    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function greetingByHour() {
      const h = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false
      }).format(new Date()));
      if (h < 6) return 'Доброй ночи';
      if (h < 12) return 'Доброе утро';
      if (h < 18) return 'Добрый день';
      return 'Добрый вечер';
    }
    let page = 'home';
    let employees = [];
    let stores = [];
    let saleSelection = {}; // { sim: 2, mnp: 1 } — мультивыбор метрик
    let scheduleMonth = todayMoscow().slice(0, 7);
    let planMonth = todayMoscow().slice(0, 7);
    let me = null; // { employee_id, full_name, role, is_manager }
    // Какую сеть сейчас просматривает admin в «Команде» (null = своя сеть по умолчанию).
    let adminViewOrgId = null;

    function canAdmin() {
      const r = (me && me.role) || '';
      return r === 'admin';
    }

    /** manager + admin (и is_manager с /me) — правка планов, графика, кассы */
    function canManage() {
      if (!me) return false;
      return me.role === 'manager' || me.role === 'admin' || me.is_manager === true;
    }
    /** Срез аналитики по своим точкам (без полного manage) */
    function isSupervisor() {
      return me?.role === 'supervisor';
    }
    /** Approve заявок на доступ */
    function canApprove() {
      return canManage() || isSupervisor();
    }

    // Иерархия ролей — зеркало backend/src/middleware-auth.ts ROLE_LEVEL.
    // senior входит в canManage() (через is_manager с /me), но НЕ должен
    // видеть Command Center/кабинет супервайзера — для этого отдельная
    // canViewAnalytics(), не связанная с is_manager.
    const ROLE_LEVEL = { guest: -1, trainee: 0, employee: 1, senior: 2, manager: 3, supervisor: 4, admin: 5 };
    const ROLE_ORDER = ['trainee', 'employee', 'senior', 'manager', 'supervisor', 'admin'];
    const ROLE_LABELS = {
      trainee: 'Стажёр',
      employee: 'Продавец',
      senior: 'Старший продавец',
      manager: 'Руководитель',
      supervisor: 'Супервайзер',
      admin: 'Администратор'
    };
    function roleLabel(role) {
      return ROLE_LABELS[role] || role || 'Продавец';
    }
    /** Command Center и кабинет супервайзера — намеренно без senior. */
    function canViewAnalytics() {
      return me?.role === 'manager' || me?.role === 'admin' || me?.role === 'supervisor';
    }
    /** Роли, которые текущий пользователь может назначить (строго ниже своей; admin — все). */
    function assignableRoles(myRole) {
      if (myRole === 'admin') return ROLE_ORDER;
      const myLevel = ROLE_LEVEL[myRole] ?? -1;
      return ROLE_ORDER.filter((r) => ROLE_LEVEL[r] < myLevel);
    }

    const STORE_COLORS = {
      kosmonavtov: '#6d9eeb',
      kalinina2: '#ff6d01',
      kalinina11: '#ffd966'
    };

    function storeColor(storeId, store) {
      if (store && store.color) return store.color;
      return STORE_COLORS[storeId] || '#2aabee';
    }

    function authHeaders(json = false) {
      const h = {
        'X-Telegram-Id': String(tgUser()?.id || ''),
        // Сырой initData — бэкенд проверяет его подпись (HMAC), только так
        // telegram_id можно доверять. Голый X-Telegram-Id легко подделать
        // с любого сайта (используется лишь как dev-фоллбэк на сервере).
        'X-Telegram-Init-Data': tg?.initData || ''
      };
      if (json) h['Content-Type'] = 'application/json';
      return h;
    }

    // Единственный список меток метрик на фронтенде — держим в точности как
    // FALLBACK в backend/src/services/metrics-catalog.ts (бэкенд отдаёт то же
    // самое через /metrics, если plan_metrics в БД пусто). Раньше почти
    // каждый экран (главная, график, план, команда) держал свою копию с
    // мелкими расхождениями — «Аксы» vs «Аксессуары», «Тел» vs «Телефоны» —
    // и они расходились по мере правок. Теперь все экраны читают отсюда
    // через metricLabel()/metricShort(), а не хранят свои строки.
    let METRICS = [
      { id: 'sim',             label: 'SIM',            short_label: 'SIM',     unit: 'шт' },
      { id: 'mnp',             label: 'MNP',            short_label: 'MNP',     unit: 'шт' },
      { id: 'pa',              label: 'ПА',             short_label: 'ПА',      unit: 'шт' },
      { id: 'combo',           label: 'Комбо',          short_label: 'Комбо',   unit: 'шт' },
      { id: 'phones',          label: 'Телефоны',       short_label: 'Тел',     unit: '₽' },
      { id: 'accessories',     label: 'Аксессуары',     short_label: 'Аксы',    unit: '₽' },
      { id: 'settings',        label: 'Настройки',      short_label: 'Доп',     unit: '₽' },
      { id: 'insurance',       label: 'Страховки',      short_label: 'Страх',   unit: '₽' },
      { id: 'wink',            label: 'Wink',           short_label: 'Wink',    unit: '₽' },
      { id: 'shpd',            label: 'ШПД',            short_label: 'ШПД',     unit: 'шт' },
      { id: 'focus',           label: 'ФО',             short_label: 'ФО',      unit: '₽' },
      { id: 'credit_request',  label: 'Кредит заявка',  short_label: 'Кр.з',    unit: 'шт' },
      { id: 'credit_issued',   label: 'Кредит выдан',   short_label: 'Кр.в',    unit: '₽' },
      { id: 'plotter',         label: 'Плоттер',        short_label: 'Плот',    unit: 'шт' },
      { id: 'hb',              label: 'НВ',             short_label: 'НВ',      unit: 'шт' }
    ];

    async function loadMetricsCatalog() {
      try {
        const res = await fetch(API + '/metrics', { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const items = data.items || [];
        if (items.length) {
          METRICS = items.map(m => ({
            id: m.id,
            label: m.label || m.id,
            short_label: m.short_label || m.label || m.id,
            unit: m.unit || (m.unit_type === 'money' ? '₽' : 'шт')
          }));
        }
      } catch (e) { console.warn('metrics', e); }
    }

    // Единая точка чтения метки метрики — вместо своей копии на каждом экране.
    function metricLabel(id) {
      return METRICS.find(m => m.id === id)?.label || id;
    }
    function metricShort(id) {
      return METRICS.find(m => m.id === id)?.short_label || metricLabel(id);
    }

