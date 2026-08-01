# T2 Sales v7

## Что нового
1. **Кастомные метрики плана** — manager добавляет пункты (не только SIM/MNP/ПА)
2. **Касса** — ежедневно по точкам: факт, 1С, ± (как Excel)
3. **Расчёт комбо** — цена телефона + % скидки (15–40) → `цена − % + 28% + 1900`
4. **BFQ** — нормальная кнопка-row вместо кривого link-row

## SQL
`schema-v7.sql`

## Backend
`routes-v7.ts` → `src/routes-v7.ts`

```ts
import { registerV7Routes } from './routes-v7.js';
await registerV7Routes(app);
```

## Frontend
Обновить `frontend/index.html`

## API
| Метод | Путь | Кто |
|-------|------|-----|
| GET | `/metrics` | все |
| POST/PATCH/DELETE | `/metrics` | manager |
| GET | `/cash/table?from=&to=` | все |
| PUT | `/cash` | manager |
| POST | `/combo/calc` | все |

## Формула комбо
```
result = phone_price * (1 - discount/100) + phone_price * 0.28 + 1900
```
discount ∈ {15,20,25,30,35,40}

## Касса
```
delta = cash_fact - cash_1c
```
Цвета: красный сильно в минус, жёлтый около нуля, зелёный плюс.
