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

    let METRICS = [
      { id: 'sim',             label: 'SIM',            unit: 'шт' },
      { id: 'mnp',             label: 'MNP',            unit: 'шт' },
      { id: 'pa',              label: 'ПА',             unit: 'шт' },
      { id: 'combo',           label: 'Комбо',          unit: 'шт' },
      { id: 'settings',        label: 'Настройки',      unit: '₽' },
      { id: 'accessories',     label: 'Аксы',           unit: '₽' },
      { id: 'insurance',       label: 'Страх',          unit: '₽' },
      { id: 'phones',          label: 'Телефон',        unit: '₽' },
      { id: 'wink',            label: 'Wink',           unit: '₽' },
      { id: 'shpd',            label: 'ШПД',            unit: 'шт' },
      { id: 'focus',           label: 'ФО',             unit: '₽' },
      { id: 'credit_request',  label: 'Кредит заявка',  unit: 'шт' },
      { id: 'credit_issued',   label: 'Кредит выдан',   unit: '₽' },
      { id: 'plotter',         label: 'Плоттер',        unit: 'шт' },
      { id: 'hb',              label: 'НВ',             unit: 'шт' }
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
            unit: m.unit || (m.unit_type === 'money' ? '₽' : 'шт')
          }));
        }
      } catch (e) { console.warn('metrics', e); }
    }

