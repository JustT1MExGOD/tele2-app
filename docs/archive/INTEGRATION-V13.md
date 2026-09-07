# T2 Sales v13 — интеграция «нового уровня»

[Документация](../README.md) · [Обзор проекта](../../README.md)

> **Контекст документа.** Архив версии 13. Старые пути, API и SQL сохранены как исторический материал. Не используйте этот файл как инструкцию обновления текущей версии.

**Содержание**

- [Фазы](#фазы)
- [1. SQL](#1-sql)
- [2. Серверные файлы](#2-серверные-файлы)
- [3. index.ts](#3-indexts)
- [4. Веб-интерфейс](#4-веб-интерфейс)
- [Карта API версии 13](#карта-api-версии-13)
- [Брендирование и несколько организаций](#брендирование-и-несколько-организаций)

## Фазы

### Фаза A — фундамент (этот пакет) ✅ код готов

1. SQL `v13-schema.sql`
2. Сервисы: NLP, insights, gamification, alerts, live-map, forecast
3. `routes-v13.ts` + offline-queue.js
4. Подключение в `index.ts`

### Фаза B — UI (1–2 недели)

- Кнопки «Открыть / Закрыть смену» + гео
- Поле «быстрый ввод» голосом/текстом
- Экран Live-карта сети
- Блок инсайта в «Мой»
- Геймификация: уровень, стрик, бейджи
- Объявления с «прочитал»
- Касса + алерты у manager

### Фаза C — масштаб

- org_id / region на всех сущностях
- онбординг точки (wizard)
- white-label theme_json
- BI `/export/bi/daily`
- точный heatmap (поле `sale_hour`)

---

## 1. SQL

Railway → Postgres → Query → выполнить `sql/v13-schema.sql`.

Потом:

```sql
SELECT to_regclass('shift_sessions'), to_regclass('smart_alerts'), to_regclass('offline_sync_log');
```

<a id="2-backend-файлы"></a>

## 2. Серверные файлы

Скопировать в `backend/src/`:

```text
services/sales-nlp.ts
services/insights.ts
services/gamification.ts
services/alerts.ts
services/live-map.ts
services/forecast.ts
routes-v13.ts
```

Пути `../db/index.js` и `../utils/date.js` — как у остальных сервисов.

## 3. index.ts

```ts
import { registerV13Routes } from './routes-v13.js';
import { runSmartAlertsTick } from './services/alerts.js';

// после registerV8 / support:
await registerV13Routes(app);
console.log('✅ V13 routes registered');

// в cron каждые 30 мин в рабочие часы:
setInterval(() => {
  runSmartAlertsTick().catch((e) => console.error('alerts', e));
}, 30 * 60 * 1000);
```

<a id="4-frontend"></a>

## 4. Веб-интерфейс

- Положить `offline-queue.js` в `frontend/`
- В `index.html` перед основным скриптом:

```html
<script src="/offline-queue.js"></script>
```

### Открыть смену

```js
async function openShift() {
  let lat = null, lng = null, accuracy_m = null;
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
    );
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
    accuracy_m = pos.coords.accuracy;
  } catch (_) {}

  const res = await fetch(API + '/shifts/open', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ lat, lng, accuracy_m })
  });
  // ...
}
```

### Быстрый ввод

```js
async function quickSale(text) {
  const res = await fetch(API + '/sales/quick', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ text })
  });
}
```

### Офлайн

```js
// вместо прямого POST /sales при ошибке сети:
await OfflineQueue.enqueueSale({
  store_id: storeId,
  employee_id: me.employee_id,
  metrics: { sim: 2, mnp: 1 },
  sale_date: todayMoscow()
});
toast('Сохранено офлайн — уйдёт при сети', 'ok');
```

<a id="live-карта"></a>

### Карта в реальном времени

```js
const live = await fetch(API + '/network/live', { headers: authHeaders() }).then(r => r.json());
// live.stores[].status = ok|warn|critical
```

---

<a id="api-map-v13"></a>

## Карта API версии 13

| Method | Path | Кто |
|--------|------|-----|
| POST | `/shifts/open` | employee |
| POST | `/shifts/close` | employee |
| GET | `/shifts/current` | employee |
| POST | `/sales/parse` | auth |
| POST | `/sales/quick` | auth |
| POST | `/sync/batch` | auth |
| GET | `/me/insight` | employee |
| GET | `/me/self-stats` | employee |
| GET | `/me/day-plan-split` | employee |
| GET | `/network/live` | auth |
| GET | `/alerts` | manager |
| POST | `/alerts/:id/ack` | manager |
| POST | `/schedule/what-if` | manager |
| GET/POST | `/announcements` | auth / manager |
| POST | `/announcements/:id/read` | auth |
| GET | `/forecast/:storeId` | auth |
| GET | `/heatmap/:storeId` | auth |
| GET | `/cohorts/newbies` | manager |
| GET | `/export/bi/daily` | manager |

---

<a id="белый-label--мультитенант"></a>

## Брендирование и несколько организаций

Таблица `organizations` + `theme_json` + `brand_name`.
На старте можно не трогать — все точки без `org_id` работают как сейчас.
Супервайзер: уже есть `getUserStoreIds` в auth v8 — фильтруй `/network/live` по его точкам.
