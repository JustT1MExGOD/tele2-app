# Интеграция v3 в backend

## 1. SQL (Railway Postgres)

Выполни `schema-upgrade.sql`.

Назначь хотя бы одного менеджера:

```sql
UPDATE employees SET role = 'manager' WHERE id = 1;
```

## 2. Файлы

Скопируй в `backend/src/`:

| Файл артефакта | Куда |
|----------------|------|
| `services-bfq.ts` | `src/services/bfq.ts` **(заменить)** |
| `middleware-auth.ts` | `src/middleware/auth.ts` |
| `routes-v3.ts` | `src/routes-v3.js` → поправь импорты путей |

Исправь импорты в `routes-v3.ts`:

```ts
import { query } from './db/index.js';
import { ... } from './services/bfq.js';
import { ... } from './middleware/auth.js';
import { todayMoscow, currentMonthMoscow } from './utils/date.js';
```

## 3. Подключение в `src/index.ts`

```ts
import { registerV3Routes } from './routes-v3.js';

// после базовых роутов, до listen:
await registerV3Routes(app);
```

Если у тебя уже есть `/me`, `/bfq`, `/plans` — **убери дубли**, оставь версию из v3.

## 4. Аудит при продаже (опционально)

В `POST /sales` после успешного INSERT добавь:

```ts
const metric = fields.find(f => body[f] !== undefined && body[f] !== null);
if (metric) {
  await query(
    `INSERT INTO sales_audit (employee_id, store_id, sale_date, metric, delta, source, created_by)
     VALUES ($1,$2,$3,$4,$5,'api',$6)`,
    [employee_id, store_id, sale_date, metric, Number(body[metric]) || 0, request.user?.employee_id || null]
  );
}
```

## 5. Проверка

```text
GET  /bfq
GET  /bfq/1
POST /bfq/manual          (manager + X-Telegram-Id)
POST /schedules/bulk      (manager)
GET  /sales/history
GET  /export/sales.csv
GET  /export/bfq.csv
GET  /me
```

Заголовок везде:

```text
X-Telegram-Id: <telegram user id>
```

## 6. Порядок внедрения

1. SQL + role=manager  
2. bfq.ts + routes-v3  
3. Redeploy  
4. Проверка API  
5. Frontend экраны из `FRONTEND-V3-SCREENS.md`
