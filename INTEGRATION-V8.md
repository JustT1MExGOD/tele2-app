# T2 Sales v8 — Защита доступа + Супервайзер

## Идея

1. **Гость** открывает Mini App → видит только экран заявки.
2. Отправляет заявку (ФИО, опционально «я из списка»).
3. **Manager или Supervisor** подтверждает → `access_status = active`.
4. После этого полный доступ по роли:
   - `employee` — продажи, свой день
   - `manager` — всё
   - `supervisor` — кабинет по **своим** 15–20 точкам, **без** своих продаж

## SQL
Выполни `schema-v8.sql`.

## Backend файлы
| Файл | Куда |
|------|------|
| `middleware-auth-v8.ts` | `src/middleware-auth-v8.ts` (или замени старый) |
| `routes-v8.ts` | `src/routes-v8.ts` |

```ts
import { registerV8Routes } from './routes-v8.js';
await registerV8Routes(app);
```

### Важно: закрыть запись
На `POST /sales`, bulk schedule, PUT cash и т.д. в начале:

```ts
import { requireActive } from './middleware-auth-v8.js';
if (!requireActive(request, reply)) return;
```

Публичными оставь: `/health`, `/ready`, `/access/*`, `/combo/calc`.

## Роли

| role | access |
|------|--------|
| guest / none | только заявка |
| pending | ждёт approve |
| employee + active | обычная работа |
| supervisor + active | `/supervisor/dashboard`, approve заявок, свои точки |
| manager / admin | всё + назначение точек супервайзеру |

## Назначить супервайзера
```http
PATCH /employees/:id/role
{ "role": "supervisor", "store_ids": ["kosmonavtov","kalinina2", "..."] }
```

## Frontend (обязательно)
При старте:
```js
const st = await fetch(API + '/access/status', { headers: authHeaders() }).then(r => r.json());
if (st.status !== 'active') showGate(st); // форма заявки / «ожидайте»
else bootApp();
```

Экран супервайзера: `GET /supervisor/dashboard`.

## Проверка
1. Новый telegram id → `/access/status` → `none`
2. `POST /access/request` → pending
3. Manager approve → active
4. Supervisor dashboard только его store_ids
