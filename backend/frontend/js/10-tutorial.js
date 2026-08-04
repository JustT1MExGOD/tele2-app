/* 10-tutorial.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== INTERACTIVE TUTORIAL v2 =====
    // mode: 'employee' | 'manager'
    // step fields: title, text, page?, highlight?, action: 'next'|'tap'|'practice',
    //   task?, practice?: [{id,label}], note?, requireRole?

    const TUTORIAL_EMPLOYEE = [
      {
        title: 'Добро пожаловать в T2 Sales',
        text: 'Это рабочее приложение сети, не просто чат. Здесь план, продажи, график, касса и отчёты. Сейчас пройдём всё по шагам — пропуск недоступен, пока не закончишь.',
        action: 'next'
      },
      {
        title: 'Нижняя навигация',
        text: 'Внизу 5 вкладок: Главное, План, График, Мой, Команда. Это твои главные разделы. Плашка обучения СВЕРХУ — низ экрана свободен. Нажми синюю подсветку «Мой» внизу.',
        page: 'home',
        highlight: '.nav-item[data-page="my"]',
        action: 'tap',
        task: '👉 Внизу экрана (не по этой плашке) нажми «Мой» — она подсвечена'
      },
      {
        title: 'Личный кабинет',
        text: 'Во вкладке «Мой» — твоя смена, дневной и месячный план, продажи, BFQ. Если пишет «выходной», проверь график. Здесь же открывают и закрывают смену.',
        page: 'my',
        action: 'next'
      },
      {
        title: 'Открыть смену',
        text: 'В начале дня на точке: «Открыть смену». Приложение может запросить геолокацию. В конце дня — «Закрыть смену» и короткий самоотчёт. Без открытой смены часть сценариев хуже считается.',
        page: 'my',
        action: 'practice',
        task: 'Нажми зелёную кнопку «Понял: открыть смену» ниже',
        practice: [{ id: 'shift', label: '🟢 Понял: открыть смену' }]
      },
      {
        title: 'Добавить продажу',
        text: 'Кнопка «+» справа внизу или «Продажа» в кабинете. Выбери метрики (можно несколько), укажи количество, точку подтянется из графика. Обычный сотрудник вносит только свои продажи.',
        page: 'home',
        highlight: '.fab',
        action: 'tap',
        task: '👉 Нажми круглую кнопку «+» справа внизу (подсвечена). Плашка обучения не мешает.'
      },
      {
        title: 'Мульти-метрики',
        text: 'Можно сразу SIM + MNP + HB. Не оставляй предвыбор «по умолчанию» — отметь нужное сам. Ошибку можно исправить дельтой (−1 / +1), если есть права.',
        action: 'practice',
        task: 'Отметь тренировочно две метрики ниже',
        practice: [
          { id: 'm_sim', label: 'SIM' },
          { id: 'm_mnp', label: 'MNP' },
          { id: 'm_hb', label: 'HB' }
        ],
        practiceNeed: 2
      },
      {
        title: 'Быстрый ввод',
        text: 'Мой → «Быстрый ввод»: напиши «две симки и одно mnp» — система разберёт фразу. Удобно, когда руки заняты на точке.',
        page: 'my',
        action: 'practice',
        task: 'Нажми «Попробовать фразу»',
        practice: [{ id: 'quick', label: '⚡ Попробовать фразу' }]
      },
      {
        title: 'План дня по точкам',
        text: 'Вкладка «План» — дневные цели точек и прогресс. Смотри, где просадка (MNP, комбо), и усиливай слабое место, а не только «удобные» метрики.',
        page: 'plan',
        action: 'tap',
        highlight: '.nav-item[data-page="plan"]',
        task: '👉 Внизу нажми подсвеченную вкладку «План»'
      },
      {
        title: 'График',
        text: 'Вкладка «График» — кто где и в какие часы. Цвета точек разные. Своё расписание сверяй здесь, до споров в чате.',
        page: 'schedule',
        action: 'next'
      },
      {
        title: 'Планы за месяц',
        text: 'Главное → «Планы и факт за месяц». 6 ключевых метрик сразу, остальные — «Ещё метрики». Стрелки ‹ › — прошлые месяцы.',
        page: 'monthplan',
        action: 'next'
      },
      {
        title: 'Инструменты',
        text: 'На главной: BFQ, расчёт комбо, касса, live-сеть, промокоды РТК, обучение. Комбо считается на телефоне: цена − % + 28% + 1900.',
        page: 'home',
        action: 'practice',
        task: 'Открой тренировочный расчёт комбо',
        practice: [{ id: 'combo', label: '📱 Открыть расчёт комбо' }]
      },
      {
        title: 'Промокоды РТК',
        text: 'Инструменты → Промокоды РТК. Список скрытый. Тап — полный код. «Использован» убирает код у всех. «Не использован» — оставляешь в пуле.',
        action: 'next'
      },
      {
        title: 'Поддержка',
        text: 'Если что-то сломалось — раздел поддержки / тикет. Не молчи в общем чате без фактов: лучше тикет с текстом ошибки.',
        page: 'support',
        action: 'next'
      },
      {
        title: 'Офлайн',
        text: 'Нет сети — продажа может уйти в очередь и синхронизироваться позже. Не вноси одно и то же десять раз подряд «на всякий случай».',
        action: 'next'
      },
      {
        title: 'Проверка — что ты запомнил',
        text: 'Ответь на мини-тест: где смотреть личный план на сегодня?',
        action: 'practice',
        task: 'Выбери правильный ответ',
        practice: [
          { id: 'q1_ok', label: 'Вкладка «Мой»' },
          { id: 'q1_bad1', label: 'Только чат с ботом' },
          { id: 'q1_bad2', label: 'Только Google Таблица' }
        ],
        correctId: 'q1_ok'
      },
      {
        title: 'Ещё вопрос',
        text: 'Как правильно зафиксировать несколько метрик за раз?',
        action: 'practice',
        task: 'Выбери верный вариант',
        practice: [
          { id: 'q2_bad', label: 'Только одну SIM, остальное завтра' },
          { id: 'q2_ok', label: 'Мультивыбор метрик в одной продаже' },
          { id: 'q2_bad2', label: 'Писать в чат без приложения' }
        ],
        correctId: 'q2_ok'
      },
      {
        title: 'Готово — базовый курс',
        text: 'Ты прошёл обязательное обучение сотрудника. Приложение всегда можно открыть снова: Главное → Обучение. Manager’ам доступен отдельный курс по ролям.',
        action: 'next'
      }
    ];

    const TUTORIAL_MANAGER = [
      {
        title: 'Курс управляющего',
        text: 'Ты в роли manager/admin. Здесь права шире: чужие продажи, график, планы, касса, заявки, BFQ. Пройдём всё с практикой.',
        action: 'next'
      },
      {
        title: 'Заявки на доступ',
        text: 'Новые люди не попадают в приложение сами — только через заявку. Главное / команда → заявки. Одобри только реальных сотрудников, иначе будут «левые» продажи.',
        page: 'access',
        action: 'next'
      },
      {
        title: 'График bulk',
        text: 'График редактируется из Mini App: смены по дням, точка, часы. Ошибка в графике = неверный дневной план и «ложные» выходные в «Мой».',
        page: 'schedule',
        action: 'next'
      },
      {
        title: 'Месячные планы сотрудников',
        text: 'Планы и факт за месяц → тап по сотруднику (manager) → правка плана. Дневные цели дробятся от остатка / оставшиеся смены. Все метрики — в «Ещё».',
        page: 'monthplan',
        action: 'next'
      },
      {
        title: 'Дневные планы точек',
        text: 'Кнопка «Записать дневные планы в БД» материализует расчёт (доли 55/25/20 и т.д.). Без этого шаблоны/прогноз могут врать.',
        page: 'monthplan',
        action: 'practice',
        task: 'Подтверди, что понял материализацию',
        practice: [{ id: 'mat', label: 'Понял: записать планы точек' }]
      },
      {
        title: 'Касса',
        text: 'Δ = факт − (1С + 2000). Смотри дельту по дням и точкам. Красная дельта — разбор в тот же день, не в конце месяца.',
        page: 'cash',
        action: 'next'
      },
      {
        title: 'Сеть live',
        text: 'Инструменты → Сеть live: кто на смене, % плана, касса. Красная/жёлтая точка — приоритет внимания, не «ещё одно сообщение в чат».',
        page: 'live',
        action: 'next'
      },
      {
        title: 'BFQ и качество',
        text: 'BFQ — не игрушка. Смотри провал по людям, а не только топ. VMR/ручные правки — только с фактом.',
        page: 'bfq',
        action: 'next'
      },
      {
        title: 'Чужие продажи',
        text: 'Manager может вносить/править продажи сотрудников. Сотрудник — только свои. Не раздавай manager без необходимости.',
        action: 'practice',
        task: 'Выбери верное правило',
        practice: [
          { id: 'm1_ok', label: 'Employee = только свои продажи' },
          { id: 'm1_bad', label: 'Все могут править всех' }
        ],
        correctId: 'm1_ok'
      },
      {
        title: 'Роли',
        text: 'employee / manager / admin / supervisor. Admin — поддержка и роли. Supervisor — срез своих точек. Не путай с «просто старший смены».',
        action: 'next'
      },
      {
        title: 'Отчёты бота',
        text: 'Микро-отчёты и итог дня уходят в чат. Проверь, что планы и смены заведены — иначе отчёт будет «красивый ноль».',
        action: 'next'
      },
      {
        title: 'Проверка manager',
        text: 'Что сделать новичку до первой смены?',
        action: 'practice',
        task: 'Выбери полный правильный путь',
        practice: [
          { id: 'm2_bad', label: 'Сразу дать admin и забыть' },
          { id: 'm2_ok', label: 'Одобрить доступ → график → план → обучение' },
          { id: 'm2_bad2', label: 'Только добавить в чат Telegram' }
        ],
        correctId: 'm2_ok'
      },
      {
        title: 'Курс manager завершён',
        text: 'Ты закрыл обучение управляющего. Можно перезапустить из Инструментов → Обучение manager.',
        action: 'next'
      }
    ];

    let tutorialIndex = 0;
    let tutorialActive = false;
    let tutorialMode = 'employee';
    let tutorialSteps = TUTORIAL_EMPLOYEE;
    let tutorialStepDone = false;
    let practiceHits = new Set();
    let _tutTapHandler = null;

    function startTutorial(mode) {
      tutorialMode = mode === 'manager' ? 'manager' : 'employee';
      tutorialSteps = tutorialMode === 'manager' ? TUTORIAL_MANAGER : TUTORIAL_EMPLOYEE;
      tutorialIndex = 0;
      tutorialActive = true;
      tutorialStepDone = false;
      practiceHits = new Set();
      document.getElementById('tutorialOverlay').classList.add('show');
      const badge = document.getElementById('tutBadge');
      if (badge) {
        badge.textContent = tutorialMode === 'manager' ? 'Manager' : 'Сотрудник';
        badge.classList.toggle('mgr', tutorialMode === 'manager');
      }
      renderTutorialStep();
      try { tg?.HapticFeedback?.impactOccurred?.('medium'); } catch (_) {}
    }

    function startManagerTutorial() {
      if (!canManage() && !isSupervisor?.()) {
        toast('Курс manager только для управляющих', 'err');
        return;
      }
      startTutorial('manager');
    }

    function nextTutorialStep() {
      if (!tutorialActive) return;
      const step = tutorialSteps[tutorialIndex];
      if (step && step.action !== 'next' && !tutorialStepDone) {
        toast('Сначала выполни задание шага', 'err');
        return;
      }
      if (tutorialIndex >= tutorialSteps.length - 1) {
        finishTutorial();
        return;
      }
      tutorialIndex += 1;
      tutorialStepDone = false;
      practiceHits = new Set();
      renderTutorialStep();
    }

    function skipTutorial() {
      // первое обучение сотрудника — нельзя
      if (tutorialMode === 'employee' && !localStorage.getItem('t2_tutorial_done')) {
        toast('Первое обучение нельзя пропустить', 'err');
        try { tg?.HapticFeedback?.notificationOccurred?.('error'); } catch (_) {}
        return;
      }
      finishTutorial(true);
    }

    function finishTutorial(skipped) {
      tutorialActive = false;
      clearTutorialHighlight();
      detachTutTap();
      document.getElementById('tutorialOverlay').classList.remove('show');
      try {
        if (tutorialMode === 'employee') localStorage.setItem('t2_tutorial_done', '1');
        if (tutorialMode === 'manager') localStorage.setItem('t2_tutorial_mgr_done', '1');
      } catch (_) {}
      toast(skipped ? 'Обучение закрыто' : 'Обучение завершено 🎉', 'ok');
      switchPage('home');
    }

    function clearTutorialHighlight() {
      document.querySelectorAll('.tut-highlight, .tut-highlight-pulse').forEach(el => {
        el.classList.remove('tut-highlight', 'tut-highlight-pulse');
      });
      document.querySelector('.bottom-nav')?.classList.remove('tut-nav-front');
    }

    function detachTutTap() {
      if (_tutTapHandler) {
        document.removeEventListener('click', _tutTapHandler, true);
        _tutTapHandler = null;
      }
    }

    function markStepDone(msg) {
      tutorialStepDone = true;
      const task = document.getElementById('tutTask');
      if (task) {
        task.classList.add('done');
        if (msg) task.textContent = '✅ ' + msg;
      }
      const nextBtn = document.getElementById('tutNextBtn');
      if (nextBtn) nextBtn.disabled = false;
      try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch (_) {}
    }

    function renderTutorialStep() {
      const step = tutorialSteps[tutorialIndex];
      if (!step) return;

      clearTutorialHighlight();
      detachTutTap();
      tutorialStepDone = step.action === 'next';
      practiceHits = new Set();

      if (step.page) {
        try { switchPage(step.page); } catch (_) {}
      }

      const total = tutorialSteps.length;
      const n = tutorialIndex + 1;
      document.getElementById('tutStepLabel').textContent = 'Шаг ' + n + ' из ' + total;
      document.getElementById('tutTitle').textContent = step.title;
      document.getElementById('tutText').textContent =
        step.text + (step.note ? '\\n\\n' + step.note : '');

      const bar = document.getElementById('tutProgressBar');
      if (bar) bar.style.width = Math.round((n / total) * 100) + '%';

      const dots = document.getElementById('tutDots');
      if (dots) {
        // не спамим 20 точек — каждые 4
        dots.innerHTML = tutorialSteps.map((_, i) =>
          `<div class="tut-dot ${i === tutorialIndex ? 'on' : ''}"></div>`
        ).join('');
      }

      const taskEl = document.getElementById('tutTask');
      const pracEl = document.getElementById('tutPractice');
      const nextBtn = document.getElementById('tutNextBtn');
      const skipBtn = document.getElementById('tutSkipBtn');

      if (taskEl) {
        if (step.task) {
          taskEl.style.display = 'block';
          taskEl.classList.remove('done');
          taskEl.textContent = step.task;
        } else taskEl.style.display = 'none';
      }

      if (pracEl) {
        if (step.practice && step.practice.length) {
          pracEl.style.display = 'flex';
          pracEl.innerHTML = step.practice.map(p =>
            `<button type="button" data-pid="${p.id}" onclick="onTutPractice('${p.id}')">${p.label}</button>`
          ).join('');
        } else {
          pracEl.style.display = 'none';
          pracEl.innerHTML = '';
        }
      }

      nextBtn.textContent = tutorialIndex >= total - 1 ? 'Завершить' : 'Далее';
      nextBtn.disabled = !tutorialStepDone;

      // skip: нельзя на первом employee-курсе
      const firstEmployee = tutorialMode === 'employee' && !localStorage.getItem('t2_tutorial_done');
      if (skipBtn) {
        if (firstEmployee) {
          skipBtn.style.display = 'none';
        } else {
          skipBtn.style.display = '';
          skipBtn.style.visibility = tutorialIndex >= total - 1 ? 'hidden' : 'visible';
        }
      }

      // карточка сверху, если цель внизу (nav / fab) — чтобы не перекрывать
      const ov = document.getElementById('tutorialOverlay');
      const hl = step.highlight || '';
      const targetBottom = /bottom-nav|nav-item|\.fab|data-page/.test(hl);
      if (ov) {
        ov.classList.toggle('tut-dock-bottom', !targetBottom && step.action !== 'tap');
        // на tap-шагах с низом — карточка СВЕРХУ
        if (step.action === 'tap' && targetBottom) ov.classList.remove('tut-dock-bottom');
        else if (step.action === 'next' || step.action === 'practice') ov.classList.add('tut-dock-bottom');
      }

      // поднять bottom-nav над оверлеем
      document.querySelector('.bottom-nav')?.classList.remove('tut-nav-front');
      if (targetBottom) {
        document.querySelector('.bottom-nav')?.classList.add('tut-nav-front');
      }

      if (step.highlight) {
        setTimeout(() => {
          const el = document.querySelector(step.highlight);
          if (el) {
            el.classList.add('tut-highlight', 'tut-highlight-pulse');
            // не скроллим низ экрана под карточку
            if (!targetBottom) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }, 180);
      }

      if (step.action === 'tap' && step.highlight) {
        _tutTapHandler = function (ev) {
          const el = document.querySelector(step.highlight);
          if (!el) return;
          // клик по цели или по всей nav-item зоне
          const nav = document.querySelector('.bottom-nav');
          const hit = el === ev.target || el.contains(ev.target)
            || (targetBottom && nav && nav.contains(ev.target) && ev.target.closest(step.highlight));
          if (hit) {
            // даём switchPage отработать
            setTimeout(() => {
              markStepDone('Сделано — можно жать «Далее»');
              detachTutTap();
            }, 50);
          }
        };
        document.addEventListener('click', _tutTapHandler, true);
      }
    }

    function onTutPractice(pid) {
      const step = tutorialSteps[tutorialIndex];
      if (!step) return;
      const btn = document.querySelector('#tutPractice button[data-pid="' + pid + '"]');
      if (btn) btn.classList.add('ok');

      if (step.correctId) {
        if (pid === step.correctId) {
          markStepDone('Верно');
        } else {
          toast('Неверно — подумай ещё', 'err');
          try { tg?.HapticFeedback?.notificationOccurred?.('error'); } catch (_) {}
          if (btn) setTimeout(() => btn.classList.remove('ok'), 400);
        }
        return;
      }

      practiceHits.add(pid);
      const need = step.practiceNeed || 1;
      if (practiceHits.size >= need) {
        markStepDone('Практика ок');
      }

      // side effects for realism
      if (pid === 'combo') {
        try { openComboCalc(); } catch (_) {}
      }
      if (pid === 'quick') {
        toast('Пример: «две симки и одно mnp»', 'ok');
      }
    }

    function maybeOfferTutorial() {
      try {
        if (localStorage.getItem('t2_tutorial_done')) return;
        // первое обучение — принудительно, без флага offered-skip
        setTimeout(() => {
          if (!tutorialActive) startTutorial('employee');
        }, 900);
      } catch (_) {}
    }

    window.maybeOfferTutorial = maybeOfferTutorial;
    window.startTutorial = startTutorial;
    window.startManagerTutorial = startManagerTutorial;


    
