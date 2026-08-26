# Desktop UX Audit

Снимок на 20.39.1, перед 20.40 (Design System + Home). Задача — понять,
что реально существует сегодня, прежде чем переделывать что бы то ни было.
Ничего в этом документе не изменяет поведение приложения; это карта, не
план (план — [DESKTOP-DESIGN.md](./DESKTOP-DESIGN.md)).

## Роутинг

`switchPage(name)`/`loadPage(name)` (`frontend/src/app/nav.ts`) —
единственный диспетчер, сознательно НЕ URL/hash-based (Telegram Mini App
без серверных роутов; `router.ts` сам объясняет это в комментарии).
`loadPage()` — плоская цепочка `if`, 24 разные ветки на 27 page id (4
вкладки супервайзера делят одну ветку). `switchPage()` переключает
`.page.active` и `.nav-item.active` нескоупленным `querySelectorAll` — это
и есть механизм, благодаря которому третий nav-контейнер (десктопный
сайдбар, 20.39) заработал без единой правки JS. `switchPage()` сама по
себе не знает о ширине экрана вообще; единственное место с
`window.innerWidth`-проверками — `initSwipePanels()` (тот же файл).

Один page id — **`today`** — мёртвый: `loadPage()` его диспетчерит
(`loadTodaySchedule()`), но ни одна кнопка нигде в `src/` не вызывает
`switchPage('today')`. Не трогается в 20.40 — см. открытый пункт в конце
документа.

## Реальность доступа (ключевой вывод для IA)

Почти каждая страница **видна всем**. Ролью гейтится обычно не сама
страница, а запись/редактирование внутри неё (`canManage()` прячет
кнопки создания/правки, не саму страницу). По-настоящему гейтится на
уровне страницы только `access`/`orgs`/`audit`/`sv-*`.

Практическое следствие: паттерн "гейтить целую секцию сайдбара по роли"
(как сделал 20.39 для 5 групп) корректно ложится только на небольшую
часть страниц. Остальные ~15 "инструментов" (bfq, monthplan, netmonth,
heatmap, forecast, announce, reportimg, live, support, alerts, reports,
history) сегодня доступны только через список "Инструменты" на Главной —
не через bottom-nav и не через сайдбар. Это одинаково и на мобильном, и
на текущем десктопе — не регрессия, поэтому 20.40 не расширяет сайдбар на
них (решение зафиксировано в DESKTOP-DESIGN.md).

## Полная инвентаризация страниц

| page id | файлы | доступ | данные (API) | текущий UI-паттерн | core-задача |
|---|---|---|---|---|---|
| **home** | `index.html #page-home` + `pages/home/index.ts` (`loadHome`) | все; `commandCenterSection` — `canViewAnalytics()`; `btnMgrTutorial` — `canManage()` | `getMyDay`, `getSupervisorHealth`, `getShiftCurrent`, `getScheduleMonth`, `getStatsDaily`, `getDashboard` | вертикальный стек `.section`/`.row` + swipe-карусель (`#homeTodaySwipe`, "Мой день"↔"Сеть сегодня") | лендинг-дашборд: снимок смены, сетевые метрики, быстрые ссылки |
| **plan** | `#page-plan` + `pages/schedule/index.ts` (`loadPlanDay`) | все (только mobile bottom-nav, нет в сайдбаре) | план/факт на сегодня | вертикальный стек, `#planList` | личный план на сегодня по метрикам |
| **today** *(мёртвая)* | `#page-today` + `schedule/index.ts` (`loadTodaySchedule`) | недостижима из UI | `getStatsDaily`, `getSchedules`, `getPlansTemplate`, `getStoreDailyPlans` | вертикальный стек | мёртвый код |
| **schedule** | `#page-schedule` + `schedule/index.ts` (`loadMonthSchedule`) | все; правка — `canManage()`; сводная таблица — manager/senior/admin | `getScheduleMonth`, `getEmployees` | CSS-grid календарь на сотрудника + **реальная `<table class="sum-sch-table">`** с horizontal-scroll для менеджеров (единственный настоящий `<table>` во всём приложении, уже sticky header + sticky первая колонка) | месячный график, у менеджеров ещё сводка по сети |
| **my** | `#page-my` + `pages/my-plan/index.ts` (`loadMyPlan`) | все; непривязанный Telegram-юзер видит bind-flow | `getMe`, `getEmployees`, `getMyDay`, `getEmployeeProgress`, `getScheduleMonth`, `getBfqList`, `getPlansEmployeesMonth`; запись: `logoutPhone`, `linkPhone`, `bindMe`, `uploadAvatar` | стек карточек + `.lk-actions-grid` (2→**4 колонки на десктопе, уже адаптировано в 20.38/39**) | личный кабинет: профиль, смена, BFQ, геймификация |
| **bfq** | `#page-bfq` + `plans-bfq/index.ts` (`loadBFQ`) | все; ручная правка — `canManage()` | `getBfqList`, `getBfqEmployee`; запись `saveBfqManual` | ранжированный список `.row` | рейтинг качества BFQ за месяц |
| **access** | `#page-access` + `access-supervisor/index.ts` (`loadAccessRequests`) | вход — `canApprove()`; сама функция тоже самогейтится | `getAccessRequests`; запись `approveAccessRequest`/`rejectAccessRequest` | стек `.row` | одобрение/отклонение заявок на доступ |
| **team** | `#page-team` + `team/index.ts` (`loadTeam`) | ростер виден всем; `#managerTools` — `canManage()`; тикеты/сети/аудит внутри — `canAdmin()`; заявки на доступ — `canApprove()` | `getOrgsAdmin`, `getEmployees`, `getSales`, `getSchedules`; запись `zeroSaleMetric`/`setEmployeeRole`/`deactivateEmployee`/`createEmployee`/`createStore` | стек `.row`; модалка добавления точки уже `.modal-md` | ростер команды + продажи; менеджеры правят состав |
| **history** | `#page-history` + `support/index.ts` (`loadHistory`) | достижима только через `canManage()`-гейтед tools-панель Команды | `getSalesHistory` | стек, `#historyList` | история продаж с фильтрами |
| **orgs** | `#page-orgs` + `network-admin/index.ts` (`loadOrgsAdmin`) | `canAdmin()` | `getOrgsAdmin`; запись `saveOrg` | стек `.row` | admin: создание/правка сетей |
| **audit** | `#page-audit` + `network-admin/index.ts` (`loadAuditLog`) | `canAdmin()` | `getAuditLog` | стек, `#auditList` | admin: журнал аудита |
| **monthplan** | `#page-monthplan` + `plans-bfq/index.ts` (`loadMonthPlans`) | все (видно всей команде); правка — `canManage()` | `getPlansEmployeesMonth`, `getStoreDailyPlans`; запись `saveEmployeeMonthPlan` | список карточек `.mt-card`, внутри CSS-grid `.mt-grid` (3 кол.) — несмотря на имя класса, НЕ `<table>` | месячный план-факт по сотруднику + дневные планы точек |
| **netmonth** | `#page-netmonth` + `plans-bfq/index.ts` (`loadNetMonth`) | все | `getPlansEmployeesMonth` | стек bar-chart карточек (`.sv-store`/`.sv-bars`) | сетевая месячная динамика по метрикам |
| **support** | `#page-support` + `support/index.ts`+`access-supervisor` (`loadSupportSla`) | все; `#adminTicketsSection` — `canAdmin()` | `getFaq`, `getMyTickets`, `getSupportTickets`, `getSupportAdminTickets`; запись `createSupportTicket`/`replyTicket` | стек + чат-виджет + форма | FAQ, тикеты поддержки, SLA у админа |
| **cash** | `#page-cash` + `cash-metrics/index.ts` (`loadCash`) | видят все; `#cashEditSection` (форма ввода) — `canManage()` | `getCashTable`; запись `saveCash`/`deleteMetric`/`createMetric` | форма + grid-список с header-строкой (`.cash-cols`/`.cash-row`) в `overflow-x:auto` | ввод факта/1С по кассе, история |
| **sv-overview/stores/people/trend** | `#page-sv-*` + `access-supervisor/index.ts` (`loadSupervisorData`) | `isSupervisor()\|\|canAdmin()` | `getSupervisorDashboard` | стек `.sv-health-row`/`.sv-store`+`.sv-bars`/ранжированный список/`.sv-bar-row` | обзор сектора супервайзера |
| **heatmap** | `#page-heatmap` + `network-admin/index.ts` (`loadHeatmap`) | все | `getHeatmapPrecise` | CSS-grid `.hm-grid`/`.hm-cell`, `auto-fill` — **единственный паттерн в кодовой базе, уже responsive без брейкпоинта** | лучший час дня по точке |
| **forecast** | `#page-forecast` + `network-admin/index.ts` | все; staffing hints/apply — `canManage()` | `getForecast`, `getStaffingHints`, `runWhatIf`, `applyWhatIf` | стек + форма сценария what-if | прогноз на 7 дней, сценарии переносов смен |
| **announce** | `#page-announce` + `network-admin/index.ts` (`loadAnnouncements`) | все; создание — `canManage()` | `getAnnouncements`, `getAnnouncementReads`; запись `markAnnouncementRead`/`createAnnouncement` | стек + форма | объявления по сети |
| **reportimg** | `#page-reportimg` + `network-admin/index.ts` (`loadReportSvg`) | все | `getReportDay` | форма + SVG-превью | генерация "итог дня" картинкой |
| **live** | `#page-live` + `shift/index.ts` (`loadLiveMap`) | все | `getNetworkLive` | стек карточек статуса точек | кто на смене прямо сейчас |
| **command-center** | `#page-command-center` + `command-center/index.ts` (`loadCommandCenterPage`) | сайдбар — `canViewAnalytics()`; сама Главная-ссылка не гейтится | `getCommandCenter`, `getEmployees`; запись `changeAlertStatus`/`createTask` | health-строка + карточки `.progress-block` + список проблем | "что происходит в сети", быстрое создание задачи |
| **tasks** | `#page-tasks` + `tasks/index.ts` (`loadTasksPage`) | видят все; правка статуса — `canManage()\|\|supervisor` | `getTasks`, `getTask`; запись `changeTaskStatus`/`addTaskComment` | фильтруемый стек `.row` (Active/Done/All) | задачи по сети |
| **store-profile** | `#page-store-profile` + `store-profile/index.ts` | только drill-in; правка имени — `canManage()` | `getStoreProfile`; запись `updateStoreDisplayName` | стек карточек-метрик | профиль точки |
| **alerts** | `#page-alerts` + `alerts/index.ts` (`loadAlertsPage`) | все | `getAlerts`; запись `markAlertRead`/`changeAlertStatus` | фильтруемый стек | полный жизненный цикл алертов |
| **employee-profile** | `#page-employee-profile` + `employee-profile/index.ts` | только drill-in | `getEmployeeProfile` | стек карточек-метрик | профиль сотрудника |
| **reports** | `#page-reports` + `reports/index.ts` (`loadReportsPage`) | все; отправка дайджеста — `canManage()` | `getAlertsEffectiveness`; `sendNetworkDigest` (features) | стек | сводка/экспорт/дайджест по сети |

**Не-`page-*` фичи** (модалки, не страницы): `add-sale` (FAB, всем),
`promos` (Home), `tutorial` (полноэкранный оверлей coach-marks), `send-network-digest`
(без своего UI, вызывается из reports.ts).

## Текущее покрытие desktop-CSS

`styles.css`, блок `@media (min-width: 860px)` (~200 строк) трогает
только shell/глобальные селекторы (`.desktop-shell`, `.sidebar`,
`.app-header`, `.sheet`, `.fab`, модальная система) плюс три
page-specific правила, явно помеченные в коде комментарием "перенесено
без изменений из 20.38, не новая работа 20.40":

- `.lk-actions-grid` (my-plan, 2→4 колонки)
- `.sum-sch-table`/`.sum-sch-name` (сводная таблица графика — только
  шрифт/ширина колонки)
- `.swipe-track` (Главная — принудительный grid через `!important` поверх
  инлайн-стилей JS; именно этот приём — причина двух реальных багов,
  найденных и исправленных дважды за сессию 20.39.0/20.39.1; 20.40
  заменяет его отдельным DOM вместо третьей заплатки — см.
  DESKTOP-DESIGN.md)

Все остальные страницы — включая Team, Command Center, Cash, BFQ,
страницы супервайзера, monthplan/netmonth — **не имеют вообще никакой**
desktop-специфичной раскладки: контент просто переливается внутрь общей
колонки `.sheet{max-width:800/1120px}` на том же количестве колонок, что
и на мобильном (`.cash-cols`/`.mt-grid`/`.sv-bars`/`.stats-row` —
захардкоженные 3-4-колоночные CSS Grid без единого правила на 860px+).

## Существующие table/grid паттерны

| Селектор | Механизм | Мобильное поведение | Правило на 860px+ |
|---|---|---|---|
| `.sum-sch-table` | настоящий `<table>` | до 31 колонки-даты + sticky-имя, horizontal scroll | только `font-size`/ширина колонки |
| `.cash-row`/`.cash-cols` | CSS Grid | фикс. 4 колонки | нет |
| `.mt-card`/`.mt-grid` | flex-список карточек, внутри grid | 3 (или 4 в `.mt-grid-4`) колонки | нет |
| `.sv-store`/`.sv-bars` | карточка + grid-строки | фикс. 3-колоночная строка | нет |
| `.hm-grid`/`.hm-cell` | CSS Grid `auto-fill` | сам масштабируется по ширине | не нужно — уже responsive |
| `.stats-row`/`.stat-chip` | CSS Grid | фикс. 3 колонки | нет |
| `.lk-actions-grid` | CSS Grid | фикс. 2 колонки | **есть**: 4 колонки |

Единственный настоящий `<table>` во всём приложении — `.sum-sch-table`
(`schedule/index.ts`). Нигде больше `<table>`/`<thead>`/`<tr>` не
встречается — всё остальное на CSS Grid или flex.

**Sort/filter**: интерактивного sort/filter UI в приложении сегодня нет
вообще. Все `.sort()` — фиксированная, односторонняя JS-сортировка без
пользовательского контроля (сортировка ключей группировки в Team,
BFQ-рейтинга в my-plan, сотрудников/точек в schedule). Будущий
`.data-table` (Team, 20.41+) — génuinely новая функциональность без
прецедента для копирования.

## Токены дизайн-системы (для справки, полный список в DESKTOP-DESIGN.md)

Spacing `--sp-1..6,8` (4/8/12/16/20/24/32px, нет `--sp-7`), radius
`--radius-xs..xl` (8-28px), type `--fs-xs..3xl` (11-28px), веса
`--fw-med/semi/bold/black`, цвета `--surface/-2/-3`, `--primary`/`-soft`,
`--success`/`-soft`, `--warning`/`-soft`, `--danger`/`-soft`, `--hint`,
`--border`/`-strong`, тени `--shadow-xs/sm/md/lg`, движение
`--dur-fast/base/slow` + `--ease`/`--ease-out`.

## Открытый пункт (флаг, не блокер)

Мёртвая страница `today` (задиспетчерена в `loadPage()`, недостижима из
UI) не трогается в 20.40 — не связана с desktop UX, удаление мёртвого
кода параллельно с большим визуальным заходом смазало бы, что изменилось
и почему. Кандидат на отдельную мелкую правку в будущем.
