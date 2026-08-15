/* 10-tutorial.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен.
   ===== INTERACTIVE TUTORIAL v3 — «игровой уровень» с Арбузычем =====
   Два визуальных режима:
   - cutscene (#tutorialScreen) — полноэкранный Арбузыч: вступление, главы, квиз, финал.
   - coach (#tutorialOverlay)   — карточка поверх реального UI: «нажми сюда», spotlight.
   step fields: title, text, kind: 'cutscene'|'coach'|'practice-real', chapter?, page?,
     highlight?, task?, practice?: [{id,label}], practiceNeed?, correctId?, celebrate?, finale?, reward? */

    const CHAPTERS_EMPLOYEE = ['Знакомство', 'Смена', 'Продажи', 'План и график', 'Инструменты'];
    const CHAPTERS_MANAGER = ['Роль управляющего', 'Люди', 'График и планы', 'Касса и сеть'];

    const TUTORIAL_EMPLOYEE = [
      {
        kind: 'cutscene', chapter: 1,
        title: 'Здоро́во!',
        text: 'Я Арбузыч, работаю тут дольше всех — точки менял, а форму продажи открываю каждый день. Это не просто чат с ботом, а рабочее место сети: план, продажи, график, касса, отчёты. Пять минут — и ты не будешь плавать в первую смену. Погнали?'
      },
      {
        kind: 'coach', chapter: 1,
        title: 'Нижняя навигация',
        text: 'Внизу пять вкладок — твои главные разделы. Плашка сверху, низ экрана свободен.',
        page: 'home',
        highlight: '.nav-item[data-page="my"]',
        task: '👉 Внизу нажми подсвеченную вкладку «Мой»'
      },
      {
        kind: 'cutscene', chapter: 1, celebrate: true,
        title: 'Глава 1 пройдена!',
        text: 'Норм для начала. Дальше — самое важное: как устроен твой рабочий день.'
      },

      {
        kind: 'cutscene', chapter: 2, page: 'my',
        title: 'Твой кабинет',
        text: 'Здесь твоя смена, дневной и месячный план, продажи, BFQ. Если пишет «выходной» — проверь график, но продажи всё равно можно вносить. Смену открывают и закрывают тоже тут.'
      },
      {
        kind: 'cutscene', chapter: 2, page: 'my',
        title: 'Открыть смену',
        text: 'В начале дня на точке жми «Открыть смену» — приложение зафиксирует время (может спросить геолокацию). В конце дня — «Закрыть смену» и короткий самоотчёт. Без открытой смены часть цифр считается хуже.',
        practice: [{ id: 'shift', label: '🟢 Понял: открыть смену' }]
      },
      {
        kind: 'cutscene', chapter: 2, celebrate: true,
        title: 'Глава 2 пройдена!',
        text: 'Отлично. Теперь — то, ради чего всё затевалось: продажи.'
      },

      {
        kind: 'coach', chapter: 3,
        title: 'Кнопка «+»',
        text: 'Круглая синяя кнопка справа внизу — твой главный инструмент. Она же есть в кабинете как «Продажа».',
        page: 'home',
        highlight: '.fab',
        task: '👉 Нажми круглую кнопку «+» справа внизу'
      },
      {
        kind: 'practice-real', chapter: 3,
        title: 'Заполни как в жизни',
        text: 'Сейчас откроется настоящая форма — та же самая, что и в реальной работе. Смело жми, выбирай пару метрик, ставь количество и нажимай «Добавить». Это тренировка — в базу ничего не запишется и в чат команде ничего не уйдёт.',
        practiceLabel: '📱 Открыть форму продажи'
      },
      {
        kind: 'cutscene', chapter: 3,
        title: 'Быстрый ввод',
        text: 'Мой → «Быстрый ввод»: напиши «две симки и одно mnp» — приложение само разберёт фразу. Удобно, когда руки заняты на точке.',
        practice: [{ id: 'quick', label: '⚡ Попробовать фразу' }]
      },
      {
        kind: 'cutscene', chapter: 3, celebrate: true,
        title: 'Глава 3 пройдена!',
        text: 'Теперь ты умеешь ровно то, что будешь делать чаще всего. Дальше — куда смотреть, чтобы понимать картину дня.'
      },

      {
        kind: 'coach', chapter: 4,
        title: 'Вкладка «План»',
        text: 'Дневные цели точек и прогресс — смотри, где просадка (MNP, комбо), и усиливай слабое место, а не только «удобные» метрики.',
        page: 'home',
        highlight: '.nav-item[data-page="plan"]',
        task: '👉 Внизу нажми подсвеченную вкладку «План»'
      },
      {
        kind: 'cutscene', chapter: 4, page: 'schedule',
        title: 'График',
        text: 'Вкладка «График» — кто где и в какие часы. Цвета точек разные. Своё расписание сверяй здесь, до споров в чате.'
      },
      {
        kind: 'cutscene', chapter: 4, page: 'monthplan',
        title: 'Планы за месяц',
        text: 'Главное → «Планы и факт за месяц». Шесть ключевых метрик сразу на виду, остальные — под «Ещё метрики». Стрелки ‹ › листают прошлые месяцы.'
      },
      {
        kind: 'cutscene', chapter: 4, celebrate: true,
        title: 'Глава 4 пройдена!',
        text: 'С планами разобрались. Последний рывок — по мелочи, но полезно.'
      },

      {
        kind: 'cutscene', chapter: 5, page: 'home',
        title: 'Комбо на пальцах',
        text: 'На главной есть инструменты: BFQ, расчёт комбо, касса, live-сеть, промокоды. Комбо считается прямо на телефоне: цена минус скидка, плюс 28%, плюс 1950.',
        practice: [{ id: 'combo', label: '📱 Открыть расчёт комбо' }]
      },
      {
        kind: 'cutscene', chapter: 5,
        title: 'Промокоды РТК',
        text: 'Инструменты → Промокоды РТК. Список скрытый, тап открывает полный код. «Использован» убирает его у всех, «Не использован» — оставляет в пуле для другого.'
      },
      {
        kind: 'cutscene', chapter: 5, page: 'support',
        title: 'Если что-то сломалось',
        text: 'Не молчи в общем чате без фактов — заведи тикет с текстом ошибки, так быстрее разберутся.'
      },
      {
        kind: 'cutscene', chapter: 5,
        title: 'Про офлайн',
        text: 'Нет сети — продажа уйдёт в очередь и синхронизируется позже сама. Не вноси одно и то же по десять раз «на всякий случай» — она не потеряется.'
      },
      {
        kind: 'cutscene', chapter: 5, celebrate: true,
        title: 'Глава 5 пройдена!',
        text: 'Всё, теории больше нет. Осталось проверить, что запомнил — и ты в деле.'
      },

      {
        kind: 'cutscene',
        title: 'Проверка первая',
        text: 'Где смотреть личный план на сегодня?',
        practice: [
          { id: 'q1_ok', label: 'Вкладка «Мой»' },
          { id: 'q1_bad1', label: 'Только чат с ботом' },
          { id: 'q1_bad2', label: 'Только Google Таблица' }
        ],
        correctId: 'q1_ok'
      },
      {
        kind: 'cutscene',
        title: 'Проверка вторая',
        text: 'Как правильно зафиксировать несколько метрик за раз?',
        practice: [
          { id: 'q2_bad', label: 'Только одну SIM, остальное завтра' },
          { id: 'q2_ok', label: 'Мультивыбор метрик в одной продаже' },
          { id: 'q2_bad2', label: 'Писать в чат без приложения' }
        ],
        correctId: 'q2_ok'
      },
      {
        kind: 'cutscene', finale: true, celebrate: true,
        title: 'Готов к первой смене',
        text: 'Красава, прошёл весь курс. Дальше — только практика, и она у тебя точно получится. Если что забудешь — обучение всегда под рукой: Главное → Обучение.',
        reward: '🎓 +50 XP · бейдж «Обучение пройдено»'
      }
    ];

    const TUTORIAL_MANAGER = [
      {
        kind: 'cutscene', chapter: 1,
        title: 'Курс управляющего',
        text: 'Ты в роли manager или admin — права шире: чужие продажи, график, планы, касса, заявки, BFQ. Пройдёмся по тому, что добавляется поверх обычного курса.'
      },
      {
        kind: 'cutscene', chapter: 1, celebrate: true,
        title: 'Глава 1 пройдена!',
        text: 'Дальше — люди. Самая частая головная боль без порядка.'
      },

      {
        kind: 'cutscene', chapter: 2, page: 'access',
        title: 'Заявки на доступ',
        text: 'Новые люди не попадают в приложение сами — только через заявку. Одобряй тут, в «Команда» → заявки. Одобришь не того — получишь «левые» продажи в отчётах, так что сверяй ФИО.'
      },
      {
        kind: 'cutscene', chapter: 2,
        title: 'Роли',
        text: 'employee / manager / admin / supervisor. Admin — ещё и поддержка с ролями, supervisor — срез только своих точек. Не путай с «просто старший смены» — это реальные права в системе.'
      },
      {
        kind: 'cutscene', chapter: 2, celebrate: true,
        title: 'Глава 2 пройдена!',
        text: 'С людьми разобрались. Теперь — график и планы, тут ошибки дороже всего.'
      },

      {
        kind: 'cutscene', chapter: 3, page: 'schedule',
        title: 'График bulk',
        text: 'Редактируется прямо здесь: смены по дням, точка, часы. Ошибка в графике — это неверный дневной план и «ложные» выходные у человека в «Мой».'
      },
      {
        kind: 'cutscene', chapter: 3, page: 'monthplan',
        title: 'Месячные планы сотрудников',
        text: 'Планы и факт за месяц → тап по сотруднику (у тебя есть права правки). Дневная цель дробится от остатка плана на оставшиеся смены — все метрики смотри через «Ещё».'
      },
      {
        kind: 'cutscene', chapter: 3, page: 'monthplan',
        title: 'Дневные планы точек',
        text: 'Дневной план каждой точки считается от остатка месячного плана и пересчитывается сам — каждое утро в 6:00 и сразу же, если кто-то поправил план точки в течение дня. Руками ничего нажимать не нужно.'
      },
      {
        kind: 'cutscene', chapter: 3, celebrate: true,
        title: 'Глава 3 пройдена!',
        text: 'Планы и график — база. Последнее — деньги и картина сети целиком.'
      },

      {
        kind: 'cutscene', chapter: 4, page: 'cash',
        title: 'Касса',
        text: 'Дельта = факт минус (1С плюс 2000). Смотри по дням и точкам — красная дельта разбирается в тот же день, не в конце месяца, иначе концов не найдёшь.'
      },
      {
        kind: 'cutscene', chapter: 4, page: 'live',
        title: 'Сеть live',
        text: 'Инструменты → Сеть live: кто на смене, % плана, касса. Красная или жёлтая точка — это приоритет действия, а не «ещё одно сообщение в чат».'
      },
      {
        kind: 'cutscene', chapter: 4, page: 'bfq',
        title: 'BFQ и качество',
        text: 'BFQ — не игрушка для галочки. Смотри, где реально просадка по людям, а не только на топ. Ручные правки VMR делаются строго с фактом на руках.'
      },
      {
        kind: 'cutscene', chapter: 4,
        title: 'Отчёты бота',
        text: 'Микро-отчёты и итог дня уходят в чат сами. Но если план и смены не заведены — отчёт получится «красивый ноль», проверяй это заранее.'
      },
      {
        kind: 'cutscene', chapter: 4, celebrate: true,
        title: 'Глава 4 пройдена!',
        text: 'Всё по делу разобрали. Осталось закрепить — и курс твой.'
      },

      {
        kind: 'cutscene',
        title: 'Проверка первая',
        text: 'Кто может вносить и править чужие продажи?',
        practice: [
          { id: 'm1_ok', label: 'Manager/admin — да, employee — только свои' },
          { id: 'm1_bad', label: 'Все могут править всех' }
        ],
        correctId: 'm1_ok'
      },
      {
        kind: 'cutscene',
        title: 'Проверка вторая',
        text: 'Что сделать новичку до первой смены?',
        practice: [
          { id: 'm2_bad', label: 'Сразу дать admin и забыть' },
          { id: 'm2_ok', label: 'Одобрить доступ → график → план → обучение' },
          { id: 'm2_bad2', label: 'Только добавить в чат Telegram' }
        ],
        correctId: 'm2_ok'
      },
      {
        kind: 'cutscene', finale: true, celebrate: true,
        title: 'Курс управляющего пройден',
        text: 'Готово — теперь у тебя есть весь контекст, не только права. Перезапустить курс можно из Инструментов → «Обучение manager».',
        reward: '🎓 +50 XP · бейдж «Обучение управляющего пройдено»'
      }
    ];

    let tutorialIndex = 0;
    let tutorialActive = false;
    let tutorialMode = 'employee';
    let tutorialSteps = TUTORIAL_EMPLOYEE;
    let tutorialStepDone = false;
    let practiceHits = new Set();
    let _tutTapHandler = null;

    function stepChapters() {
      return tutorialMode === 'manager' ? CHAPTERS_MANAGER : CHAPTERS_EMPLOYEE;
    }

    function needsAction(step) {
      return step.kind === 'coach' || step.kind === 'practice-real' || !!(step.practice && step.practice.length);
    }

    function startTutorial(mode) {
      tutorialMode = mode === 'manager' ? 'manager' : 'employee';
      tutorialSteps = tutorialMode === 'manager' ? TUTORIAL_MANAGER : TUTORIAL_EMPLOYEE;
      tutorialIndex = 0;
      tutorialActive = true;
      tutorialStepDone = false;
      practiceHits = new Set();
      window.__tutorialDryRun = false;
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
      if (step && needsAction(step) && !tutorialStepDone) {
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
      window.__tutorialDryRun = false;
      window.__tutorialDryRunCallback = null;
      document.getElementById('tutorialOverlay')?.classList.remove('show');
      document.getElementById('tutorialScreen')?.classList.remove('show');
      try {
        if (tutorialMode === 'employee') localStorage.setItem('t2_tutorial_done', '1');
        if (tutorialMode === 'manager') localStorage.setItem('t2_tutorial_mgr_done', '1');
      } catch (_) {}
      if (!skipped) {
        try {
          fetch(API + '/me/tutorial-complete', {
            method: 'POST',
            headers: authHeaders(true),
            body: JSON.stringify({ mode: tutorialMode })
          }).catch(() => {});
        } catch (_) {}
      }
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
      const step = tutorialSteps[tutorialIndex];
      if (step && step.kind === 'coach') {
        const task = document.getElementById('tutTask');
        if (task) {
          task.classList.add('done');
          if (msg) task.textContent = '✅ ' + msg;
        }
        const nextBtn = document.getElementById('tutNextBtn');
        if (nextBtn) nextBtn.disabled = false;
      } else {
        const nextBtn = document.getElementById('tsNextBtn');
        if (nextBtn) nextBtn.disabled = false;
        if (msg) toast(msg, 'ok');
      }
      try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch (_) {}
    }

    function renderTutorialStep() {
      const step = tutorialSteps[tutorialIndex];
      if (!step) return;

      clearTutorialHighlight();
      detachTutTap();
      window.__tutorialDryRun = false;
      tutorialStepDone = !needsAction(step);
      practiceHits = new Set();

      const overlayEl = document.getElementById('tutorialOverlay');
      const screenEl = document.getElementById('tutorialScreen');

      if (step.kind === 'coach') {
        screenEl?.classList.remove('show');
        overlayEl?.classList.add('show');
        renderCoachStep(step);
      } else {
        overlayEl?.classList.remove('show');
        screenEl?.classList.add('show');
        renderCutsceneStep(step);
      }

      if (step.page) {
        try { switchPage(step.page); } catch (_) {}
      }
      if (step.celebrate) {
        try { confettiBurst && confettiBurst(); } catch (_) {}
        try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch (_) {}
      }
    }

    function renderCutsceneStep(step) {
      const total = tutorialSteps.length;
      const n = tutorialIndex + 1;
      const chapters = stepChapters();

      const chapterLabel = document.getElementById('tsChapterLabel');
      if (chapterLabel) {
        chapterLabel.textContent = step.chapter
          ? `Глава ${step.chapter} из ${chapters.length} · ${chapters[step.chapter - 1] || ''}`
          : 'Экзамен';
      }

      document.getElementById('tsTitle').textContent = step.title;
      document.getElementById('tsText').textContent = step.text;

      const inner = document.querySelector('#tutorialScreen .ts-inner');
      if (inner) inner.classList.toggle('finale', !!step.finale);

      const reward = document.getElementById('tsReward');
      if (reward) {
        if (step.reward) { reward.style.display = 'block'; reward.textContent = step.reward; }
        else { reward.style.display = 'none'; reward.textContent = ''; }
      }

      const pracEl = document.getElementById('tsPractice');
      if (pracEl) {
        if (step.kind === 'practice-real') {
          pracEl.style.display = 'flex';
          pracEl.innerHTML = `<button type="button" onclick="beginPracticeReal()">${step.practiceLabel || 'Попробовать по-настоящему'}</button>`;
        } else if (step.practice && step.practice.length) {
          pracEl.style.display = 'flex';
          pracEl.innerHTML = step.practice.map(p =>
            `<button type="button" data-pid="${p.id}" onclick="onTutPractice('${p.id}')">${p.label}</button>`
          ).join('');
        } else {
          pracEl.style.display = 'none';
          pracEl.innerHTML = '';
        }
      }

      const dots = document.getElementById('tsDots');
      if (dots) {
        dots.innerHTML = tutorialSteps.map((_, i) =>
          `<div class="tut-dot ${i === tutorialIndex ? 'on' : ''}"></div>`
        ).join('');
      }

      const nextBtn = document.getElementById('tsNextBtn');
      if (nextBtn) {
        nextBtn.textContent = n >= total ? 'Завершить' : 'Далее';
        nextBtn.disabled = !tutorialStepDone;
      }

      const skipBtn = document.getElementById('tsSkipBtn');
      const firstEmployee = tutorialMode === 'employee' && !localStorage.getItem('t2_tutorial_done');
      if (skipBtn) {
        if (firstEmployee) {
          skipBtn.style.display = 'none';
        } else {
          skipBtn.style.display = '';
          skipBtn.style.visibility = n >= total ? 'hidden' : 'visible';
        }
      }
    }

    function renderCoachStep(step) {
      const total = tutorialSteps.length;
      const n = tutorialIndex + 1;

      document.getElementById('tutStepLabel').textContent = 'Шаг ' + n + ' из ' + total;
      document.getElementById('tutTitle').textContent = step.title;
      document.getElementById('tutText').textContent = step.text;

      const bar = document.getElementById('tutProgressBar');
      if (bar) bar.style.width = Math.round((n / total) * 100) + '%';

      const dots = document.getElementById('tutDots');
      if (dots) {
        dots.innerHTML = tutorialSteps.map((_, i) =>
          `<div class="tut-dot ${i === tutorialIndex ? 'on' : ''}"></div>`
        ).join('');
      }

      const taskEl = document.getElementById('tutTask');
      const nextBtn = document.getElementById('tutNextBtn');
      const skipBtn = document.getElementById('tutSkipBtn');

      if (taskEl) {
        if (step.task) {
          taskEl.style.display = 'block';
          taskEl.classList.remove('done');
          taskEl.textContent = step.task;
        } else taskEl.style.display = 'none';
      }

      document.getElementById('tutPractice').style.display = 'none';

      nextBtn.textContent = n >= total ? 'Завершить' : 'Далее';
      nextBtn.disabled = !tutorialStepDone;

      const firstEmployee = tutorialMode === 'employee' && !localStorage.getItem('t2_tutorial_done');
      if (skipBtn) {
        if (firstEmployee) {
          skipBtn.style.display = 'none';
        } else {
          skipBtn.style.display = '';
          skipBtn.style.visibility = n >= total ? 'hidden' : 'visible';
        }
      }

      // карточка сверху, если цель внизу (nav / fab) — чтобы не перекрывать
      const ov = document.getElementById('tutorialOverlay');
      const hl = step.highlight || '';
      const targetBottom = /bottom-nav|nav-item|\.fab|data-page/.test(hl);
      if (ov) {
        ov.classList.toggle('tut-dock-bottom', !targetBottom);
      }

      document.querySelector('.bottom-nav')?.classList.remove('tut-nav-front');
      if (targetBottom) {
        document.querySelector('.bottom-nav')?.classList.add('tut-nav-front');
      }

      if (step.highlight) {
        setTimeout(() => {
          const el = document.querySelector(step.highlight);
          if (el) {
            el.classList.add('tut-highlight', 'tut-highlight-pulse');
            if (!targetBottom) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }, 180);
      }

      if (step.highlight) {
        _tutTapHandler = function (ev) {
          const el = document.querySelector(step.highlight);
          if (!el) return;
          const nav = document.querySelector('.bottom-nav');
          const hit = el === ev.target || el.contains(ev.target)
            || (targetBottom && nav && nav.contains(ev.target) && ev.target.closest(step.highlight));
          if (hit) {
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
      const btn = document.querySelector('#tsPractice button[data-pid="' + pid + '"]');
      if (btn) btn.classList.add('ok');

      if (step.correctId) {
        if (pid === step.correctId) {
          markStepDone('Верно');
        } else {
          toast('Мимо — подумай ещё разок', 'err');
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

    /** Открыть настоящую форму продажи в тренировочном режиме — 07-add-sale.js
        проверяет window.__tutorialDryRun и не пишет реальный POST /sales. */
    function beginPracticeReal() {
      window.__tutorialDryRun = true;
      window.__tutorialDryRunCallback = function () {
        window.__tutorialDryRun = false;
        window.__tutorialDryRunCallback = null;
        markStepDone('Готово — по-настоящему это уйдёт в базу и в чат команде');
      };
      try { openAddSale(); } catch (e) { console.warn('tutorial openAddSale failed', e); }
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
    window.beginPracticeReal = beginPracticeReal;
