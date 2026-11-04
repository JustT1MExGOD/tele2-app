# Web `.empty` → `.empty-state` audit (UI/UX 3.0)

Pass: upgrade centered standalone `.empty` blocks to the structured `.empty-state`
component (`.es-icon` + `.es-title` + `.es-sub`), leave `text-align:left`, `<td>`,
loading, and `renderLoadError` usages untouched. Report-only for sibling-alignment /
radius inconsistencies.

## Files changed (12)

| File | `.empty` upgraded | Icon / tone |
|---|---|---|
| `backend/frontend/src/pages/tasks/index.ts:86` | "Нет задач" | clipboard icon, neutral |
| `backend/frontend/src/pages/alerts/index.ts:74` | "Нет алертов" | bell icon, neutral |
| `backend/frontend/src/pages/command-center/index.ts:53` | "Нет точек в сети" | store icon, neutral |
| `backend/frontend/src/pages/command-center/index.ts:80` | "Проблем нет — сеть в ритме" | check icon, success soft/success |
| `backend/frontend/src/pages/store-profile/index.ts:114` | "Нет продаж за период" | bar-chart icon, neutral |
| `backend/frontend/src/pages/employee-profile/index.ts:135` | "Нет закрытых смен за период" | calendar icon, neutral |
| `backend/frontend/src/pages/leaderboard/index.ts:56` | "Каталог метрик пуст" | bar-chart icon, neutral |
| `backend/frontend/src/pages/leaderboard/index.ts:72` | "Пока нет продаж за выбранный период" | bar-chart icon, neutral |
| `backend/frontend/src/pages/cash-metrics/index.ts:53` | "🍉 Пока нет ни одной записи кассы" | credit-card icon, neutral |
| `backend/frontend/src/pages/dealers/index.ts:75` | "Секторов пока нет" | store icon, neutral |
| `backend/frontend/src/pages/dealers/index.ts:87` | "Дилеров пока нет" | store icon, neutral |
| `backend/frontend/src/pages/admin-center/employees.ts:49` | "Ничего не найдено" | search icon, neutral |
| `backend/frontend/src/pages/admin-center/employees.ts:115` | "Нет активных сессий" | smartphone icon, neutral |
| `backend/frontend/src/pages/admin-center/feature-flags.ts:55` | "Флагов пока нет" | flag icon, neutral |
| `backend/frontend/src/pages/admin-center/operations.ts:53` | "Открытых алертов нет" | check icon, success soft/success |
| `backend/frontend/src/pages/admin-center/operations.ts:67` | "Заявок на доступ нет" | user-check icon, neutral |
| `backend/frontend/src/pages/admin-center/miranda-devices.ts:196` | "Нет устройств, ожидающих подтверждения" | smartphone icon, success soft/success |
| `backend/frontend/src/pages/admin-center/miranda-devices.ts:384` | "Корпоративных аккаунтов пока нет" | users icon, neutral |
| `backend/frontend/src/pages/admin-center/miranda-devices.ts:480` | "Вам не выдано ни одного гранта" | users icon, neutral |
| `backend/frontend/src/pages/admin-center/miranda-devices.ts:530` | "Групп пока нет" | users icon, neutral |

## `.empty` deliberately left

| File | Reason |
|---|---|
| `backend/frontend/src/pages/team/index.ts:66,78,391,422,484` | loading states, `<td>`, modal load-error |
| `backend/frontend/src/pages/tasks/index.ts:120,141` | `text-align:left` block, modal inline note |
| `backend/frontend/src/pages/leaderboard/index.ts` — none | all page-level empty states upgraded |
| `backend/frontend/src/pages/network-admin/index.ts` | left for a second pass (file at cap): candidates at :343 "Нет точек", :477 "Нет объявлений", :616 "Сетей пока нет", :795 "Действий пока нет" |
| `backend/frontend/src/pages/schedule/index.ts` | left for a second pass (file at cap): candidates at :84 "Нет точек", :165 "Сегодня никого в графике", :201 "Пусто", :410 "Нет данных", :910 "Нет отметок недоступности" |
| `backend/frontend/src/pages/plans-bfq/index.ts` | left for a second pass (file at cap): candidates at :80 "Нет данных BFQ", :138 (modal draft empty), :198 "Нет данных за X", :716 "Нет данных", :748 "Дневные планы точек пока недоступны" |
| `backend/frontend/src/pages/home/index.ts` | left for a second pass (file at cap): candidates at :399 "Нет данных за 7 дней", :429 "Топ за 7 дней недоступен" |
| `backend/frontend/src/pages/my-plan/index.ts` | left for a second pass (file at cap): candidate at :200 "Месячный план подтянется, когда будут данные" |
| `backend/frontend/src/pages/support/index.ts` | left for a second pass (file at cap): candidates at :77 "FAQ пока пуст", :102 "Пока нет обращений", :127 "Нет тикетов", :215 "Нет открытых" |
| `backend/frontend/src/pages/access-supervisor/index.ts` | already had `.empty-state` at :960/:1250; remaining `.empty` at :953 (permission), :1031 (no-trend), :1110 (error), :1176 (no critical dips), :1273 (no sales), :1334 (no stores) — left as-is, several are permission/error contexts |
| `backend/frontend/src/pages/admin-center/audit.ts` | reverted (file cap): candidate "Записей не найдено" |
| `backend/frontend/src/pages/admin-center/business-rules.ts` | reverted (file cap): candidate "Метрик нет" |
| `backend/frontend/src/pages/admin-center/org-settings.ts` | reverted (file cap): candidate "Сетей нет" |
| `backend/frontend/src/pages/admin-center/schedule-correction.ts` | reverted (file cap): candidates "Выберите точку и месяц", "Ничего не найдено" |
| `backend/frontend/src/pages/admin-center/sheet-import.ts` | reverted (file cap): candidate "Очередь пуста — всё сопоставлено" |
| `backend/frontend/src/pages/admin-center/stores.ts` | reverted (file cap): candidate "Нет точек" |
| `backend/frontend/src/pages/admin-center/sales-correction.ts`, `shift-correction.ts`, `plan-correction.ts` | not edited this pass (file cap): search-result "Ничего не найдено" / "нет метрик" |
| `backend/frontend/src/pages/shift/index.ts` | `.empty` at :41,95,264,392,399 are `text-align:left` helper text or hidden preview — left |
| `backend/frontend/src/pages/reports/index.ts` | `.empty` at :113,128 are `text-align:left` blocks — left |

## Verification

- `cd backend && npx tsc --noEmit -p frontend/tsconfig.json` — **clean** (no output)
- `cd backend && npm run smoke:frontend` — **OK** (`Проверено файлов: 27 — ни один файл не упал при загрузке`)

## Sibling-alignment / radius findings (report-only)

1. **`backend/frontend/src/pages/network-admin/index.ts:486-487`** — `.btn-main` (`border-radius:var(--radius-md)` = 16px, `width:100%`, `padding:15px var(--sp-4)`) followed by `.mchip` (`border-radius:12px`, `padding:12px 6px`) in the same card: mismatched radius + height between stacked CTAs.
2. **`backend/frontend/src/pages/network-admin/index.ts:344-347`** — `.btn-main` and `.btn-ghost` both `width:100%` inside `display:flex` with `flex:1` on each: `width:100%` inside a flex row fights the `flex:1` sizing (both buttons claim full width); works by accident, fragile.
3. **`backend/frontend/src/pages/admin-center/miranda-devices.ts`** — account rows mix `.mchip` action buttons (12px radius, `padding:12px 6px`) with `.btn-main`/`.btn-ghost` (16px radius, `padding:15px var(--sp-4)`) on the same row: consistent in that all actions use `.mchip` except the pending-queue Approve/Reject pair which uses `.btn-main`+`.btn-ghost` — two different button languages on the same screen.
4. **`backend/frontend/src/pages/command-center/index.ts:74,78`** — `.mchip` (`border-radius:12px`) inside `.sv-drop` problem cards; same `.mchip` also used for "Взять в работу" — consistent within the card, but `.mchip` (12px) is the only chip-radius token used while `.btn-main`/`.btn-ghost` use `--radius-md` (16px) — a systemic radius mismatch between "chip" and "button" classes.
5. **`backend/frontend/src/pages/dealers/index.ts:36,73`** — `.mchip` rename buttons inside `.sv-store-head` / `.section-title` — same 12px vs 16px radius gap vs any `.btn-main`/`.btn-ghost` on the page (there are none here, so it's a latent inconsistency rather than a visible one).
6. **`backend/frontend/styles.css`** — `.mchip` uses hard `border-radius:12px` and `.quick button` uses `border-radius:12px` while `.btn-main`/`.btn-ghost`/`.section` use `--radius-md`/`--radius`; `.store-badge` uses `border-radius:14px` and `.sheet-modal` uses `border-radius:24px 24px 0 0` (matches `--radius-lg` = 24px, not tokenized). Several ad-hoc radii sit off the `--radius-*` scale.
7. **`backend/frontend/styles.css`** — `.bar`/` .bar > i` use `border-radius:3px`, `.chip` uses `border-radius:20px`, `.sum-sch-scroll` uses `border-radius:10px`, `.sum-sch-table th,td` use `border-radius:8px` — all off the `--radius-xs/sm/md/lg` scale.
