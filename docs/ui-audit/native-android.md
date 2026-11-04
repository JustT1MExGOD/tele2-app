# UI/UX 3.0 audit — native Android (`native/androidApp`)

Scope: visual consistency pass — token substitution, alignment, empty/error states.
Verify: `cd native && JAVA_HOME=... ./gradlew :androidApp:compileDebugKotlin --console=plain -q`

## Build result

`compileDebugKotlin` — **clean, exit 0**. The two known pre-existing errors are now fixed
(see below); no new errors were introduced in any edited file.

## Changes made (file → what)

### Pre-existing compile errors (fixed — trivial port gaps)

- `ui/ported/OrgsScreen.kt` — added missing `import androidx.compose.foundation.layout.Arrangement`
  (the `FlowRow` at :93 used `Arrangement.spacedBy` but the import was dropped in the port).
- `ui/ported/AcTabsB.kt` (`OperationsTab`) — `ErrorState(onRetry = { reload++ })` at :227 referenced a
  `reload` var that was never declared in that composable. Added `var reload` + changed
  `LaunchedEffect(Unit)` → `LaunchedEffect(reload)`, matching the pattern used everywhere else
  (e.g. `OrgsScreen.kt:51,57`).

### Lone-Text → `EmptyText` (shared component, exact `hint/13.sp/center/32dp` signature)

These were verbatim duplicates of `EmptyText` (defined `ported/AdminCenterScreen.kt:182`).

- `ui/ported/AlertsScreen.kt:81` — "Нет алертов"
- `ui/ported/HistoryScreen.kt:55` — "Нет продаж за период"
- `ui/ported/MonthPlanScreen.kt:173` — "Нет данных"
- `ui/BfqPage.kt:62` — "Нет данных BFQ"
- `ui/PlanDayScreen.kt:113` — "Нет точек"
- `ui/ported/SupportScreen.kt:63` — "FAQ пока пуст"; `:108` — "Нет тикетов"
- `ui/ported/DealersScreen.kt:79` — "Дилеров пока нет…"
- `ui/ported/LeaderboardScreen.kt:100` — "Каталог метрик пуст"
- `ui/ported/AnnounceScreen.kt:60` — "Нет объявлений" (emoji)
- `ui/ported/AuditScreen.kt:130` — "Действий пока нет" (emoji)
- `ui/ported/CashScreen.kt:120` — "…записи кассы…" (emoji)
- `ui/ported/OrgsScreen.kt:80` — "Сетей пока нет" (emoji)

### Lone-Text → `ErrorState` (failed-fetch now gets a retry button)

- `ui/ported/SupportScreen.kt:62` — `faqFailed` was a dead `Text("Не удалось загрузить FAQ")`;
  now `ErrorState(..., onRetry = { reload++ })`.

### Raw `Color(0x…)` → token

- `ui/ported/SupervisorScreen.kt:234,238` — `0xFFA1A1AA` → `T2Colors.textSecondary` (exact value).
- `ui/AddSaleSheet.kt:199` — selected-metric fill `0xFF106FA3` → `T2Colors.primaryTextBg`.
- `ui/ChatScreen.kt:268` — "new messages" pill `0xFF106FA3` → `T2Colors.primaryTextBg`.

## Deliberately left (report only)

- **40dp icon-only buttons** — `size(40.dp)` clickables in `HomeScreen.kt:211,236` (refresh/header),
  `Nav.kt:135` (back), `ported/PlanCommon.kt:69`. Below the 48dp a11y floor but uniform across the
  app and sit inside padded bars; a blanket 48dp risks overflow in the tight header rows. Flagged,
  not changed.
- **Categorical / role accent palettes** — purple analytics set (`0xFF8B5CF6`/`A78BFA`/`C4B5FD`/
  `1F2937`) in `SupervisorScreen`/`DealersScreen`; gold role badge `0xFFFFD60A` and `REPLACEMENT_COLOR`
  `0xFF00C853` store-legend in `ScheduleScreen`. No T2 token exists and they're deliberate brand/rank
  hues, not semantic status colors.
- **Gradient / hero art colors** — multi-stop `Brush` colors (`0xFF1A1A2E`, `0xFF12141C`, `0xFF0E2230`,
  `0xFF0C1A28`, …) and scrim/overlay alphas. Hand-tuned artwork; tokenizing individual stops would
  break the gradient intent.
- **Badge/chip geometry paddings** (`10/5.dp`, `14.dp` row padding, etc.) — tuned to font size; off the
  4/8 rhythm but deliberate badge geometry, not layout rhythm. Left per instructions.
- **Dialog-variant empty texts** — `SectorPicker.kt:55,56`, `ToolSheets.kt:154`, `ReplayScreen.kt:158`,
  `ScheduleDrafts.kt:368`, `TeamScreen.kt:126` use `padding(16.dp)` or no `textAlign` — different
  signature from `EmptyText`, intentional in-sheet variants. Left.
