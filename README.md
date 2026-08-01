# T2 Sales

<p align="center">
  <b>Продажи · План · График · BFQ · Личный кабинет</b><br>
  <sub>Telegram Mini App для салонов T2 · v10 Global Update</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-10.0.0-2AABEE?style=for-the-badge" alt="v10" />
  <img src="https://img.shields.io/badge/Telegram-Mini%20App-2AABEE?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" />
  <img src="https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/PostgreSQL-15+-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="Postgres" />
  <img src="https://img.shields.io/badge/Railway-Deployed-0B0D0E?style=for-the-badge&logo=railway&logoColor=white" alt="Railway" />
</p>

---

## v10 Global Update — что нового

| Блок | Описание |
|------|----------|
| **Личный кабинет** | Профиль, кольцо плана дня, метрики, месяц, неделя в цветах точек, BFQ, быстрые действия |
| **Мульти-продажи** | Несколько метрик за один раз (SIM + MNP + Аксы…) |
| **Обучение** | Интерактивный тур по всему приложению |
| **Главная** | Приветствие по времени суток, стрик продаж, пульс сети, медали в топе |
| **Haptic** | Вибрация Telegram на успех / ошибку |
| **О приложении** | Версия и changelog прямо в Mini App |

---

## Зачем это

Раньше: **Google Таблицы + Apps Script**. Работало, но тяжело с телефона, без ролей и нормального UX.

**T2 Sales** — полная замена:

| Было | Стало |
|------|--------|
| Google Sheets | PostgreSQL |
| Apps Script | Node.js + Fastify |
| Таблицачный UI | Telegram Mini App |
| Все как админы | employee / manager / admin |
| Ручной план точек | Месячные планы → дневные → точки **50 / 30 / 20** |

---

## Возможности

### Mini App
- **Главное** — приветствие, мой день, пульс сети, топ 7 дней, инструменты
- **Личный кабинет (Мой)** — профиль, смена, факт/план, неделя, BFQ, стрик
- **План дня** — карточки по точкам
- **Планы на месяц** — таблица сотрудников (видят все, правят manager)
- **График** — месяц, цвета точек, bulk-редактор смен
- **BFQ** — рейтинг + VMR / штрафы
- **Команда** — сотрудники, роли, CRUD точек
- **Касса** — факт / 1С
- **Поддержка** — FAQ + тикеты в личку админу
- **Обучение** + **О приложении**
- Светлая / тёмная тема, pull-to-refresh

### Цвета точек
| Точка | Цвет | Доля плана |
|-------|------|------------|
| Космонавтов 20А | `#6d9eeb` | **50%** |
| Калинина 11 | `#ffd966` | **30%** |
| Калинина 2 | `#ff6d01` | **20%** |

### Бот
- HTML-сообщения в личке
- Уведомления о продажах в рабочий чат
- Микро-отчёты и итоги дня
- Напоминание о смене (завтра)
- Тикеты поддержки → **ЛС админу**
- Алерты нулевых продаж / отставания точек

### Роли
| Роль | Права |
|------|--------|
| `employee` | продажи, свой кабинет, просмотр планов |
| `manager` | график, BFQ, CRUD, экспорт, месячные планы |
| `admin` | как manager + доступ |

---

## Архитектура

```text
┌─────────────────┐     HTTPS      ┌──────────────────┐      SQL      ┌────────────┐
│ Telegram Mini   │ ──────────────►│  Fastify API     │ ────────────►│ PostgreSQL │
│ App (frontend)  │                │  + static UI     │              └────────────┘
└─────────────────┘                │  + Grammy bot    │
                                   │  + cron reports  │
                                   └──────────────────┘
                                            │
                                       Railway.app
```

---

## Структура репозитория

```text
tele2-app/
├── backend/
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes-v3.ts / routes-v4.ts / routes-v6.ts
│   │   ├── middleware-auth.ts
│   │   ├── bot/
│   │   ├── cron/
│   │   ├── services/
│   │   └── utils/
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   └── index.html          ← весь UI Mini App
└── README.md
```

---

## Env (Railway)

```env
BOT_TOKEN=
DATABASE_URL=
ADMIN_TELEGRAM_ID=
CHAT_ID=
WEBAPP_URL=https://tele2-app-production.up.railway.app
PORT=8080
```

---

## Деплой

1. Push в `main` → Railway auto-deploy  
2. Postgres: schema + UNIQUE на `sales(employee_id, store_id, sale_date)` и `schedules(employee_id, work_date)`  
3. BotFather → Menu Button → Web App URL  
4. Сотрудники: `/start` боту → Mini App → вкладка **Мой** → привязка  

### Healthcheck
```text
GET /health
GET /ready
```

---

## API (кратко)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/me` | Текущий сотрудник |
| POST | `/me/bind` | Привязка Telegram |
| GET | `/me/day` | Мой день |
| POST | `/sales` | Upsert продажи (partial metrics) |
| GET | `/schedules` · `/schedules/month` | График |
| POST | `/schedules/bulk` | Массовое сохранение смен |
| GET | `/plans/employees/month` | Месячные планы (все) |
| PUT | `/plans/employees/month` | Правка (manager) |
| GET | `/bfq` | Рейтинг |
| GET | `/dashboard` | Топ / сводка |
| POST | `/support/tickets` | Тикет |

Заголовок авторизации: `X-Telegram-Id`.

---

## Локальная разработка

```bash
cd backend
npm ci
npm run build
npm start
# frontend отдаётся из backend/static или /frontend
```

---

## Чеклист после v10

- [ ] `frontend/index.html` задеплоен  
- [ ] UNIQUE constraint на `sales`  
- [ ] Привязка сотрудников работает  
- [ ] Мультивыбор метрик сохраняет все поля  
- [ ] Вкладка **Мой** показывает кабинет  
- [ ] **Обучение** и **О приложении** открываются  
- [ ] Стрик растёт после продажи  

---

**T2 Sales v10** — не таблица. Это операционная система салона в Telegram.
