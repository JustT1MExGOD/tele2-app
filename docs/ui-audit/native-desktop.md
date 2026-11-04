# Native desktop — UI/UX 3.0 consistency pass

Scope: `native/desktopApp` (Compose Desktop). Token source:
`native/shared/.../theme/T2Tokens.kt`.

## Changed

- `shared/.../theme/T2Tokens.kt` — added `T2Colors.primaryTextBg = 0xFF106FA3`,
  porting `--primary-text-bg` from `backend/frontend/styles.css:115,206` (AA-safe
  blue for white text, same value both themes).
- `ui/chat/ChatScreen.kt:290` — "Новые сообщения ↓" pill bg `Color(0xFF106FA3)` →
  `T2Colors.primaryTextBg`.
- `ui/sales/AddSaleDialog.kt:192` — selected metric chip bg `Color(0xFF106FA3)` →
  `T2Colors.primaryTextBg`.
- `ui/supervisor/SupervisorScreen.kt:238,242` — "Темп:"/"Просадки:" labels
  `Color(0xFFA1A1AA)` → `T2Colors.textSecondary` (exact match of the dark-mode
  token value).
- `ui/shell/UpdateCard.kt:71,98,108` — mandatory-update / signature-warning text
  `0xFFEF6C00` → `T2Colors.warning`; update error `0xFFC62828` → `T2Colors.danger`.
  Dropped now-unused `Color` import.
- `ui/shell/NetworkIndicator.kt:40-43,87-91` — diagnostic-outcome and
  relay-reachability colors mapped off Material-palette hexes onto tokens:
  `0xFF2E7D32`→`success`, `0xFFEF6C00`→`warning`, `0xFFC62828`→`danger`,
  `0xFF757575`→`hint`.

## Deliberately left

- `schedule/ScheduleScreen.kt:88` `REPLACEMENT_COLOR = 0xFF00C853` — web pins the
  same `#00c853` for the replacement placeholder (`schedule/index.ts:290,469`);
  it is a domain color, not generic success.
- Alpha-white overlays (`0x0FFFFFFF`, `0x1FFFFFFF`, `0xE6FFFFFF`, …) across
  Home/Profile/Supervisor/ShiftAchievement — all sit on dark hero gradients;
  theme-aware surface tokens would change their appearance.
- `13.dp` row padding / `14.dp` card padding (~30 call sites each) — a consistent
  ported convention, ±1dp off token rhythm; fixing is a mass change, reported not
  done.
- `10.dp`/`14.dp`/`22.dp` `RoundedCornerShape` values — 30+ sites, each ±2dp off
  `T2Radius`; same mass-change category.
- Purple accent family (`0xFF8B5CF6`/`0xFFA78BFA`/`0xFFC4B5FD`) used by both
  `SupervisorScreen` (private `PURPLE` vals) and `admin/DealersScreen.kt:228,234`
  (raw hex) — candidate for a `T2Colors` purple token; new design decision, left.
- `profile/ProfileScreen.kt:535` `DarkPill` bg `0xFF1C1C24` vs `surface2`
  `0xFF1C1C1F` — near-identical but deliberately non-theme-aware on a dark hero.
- `0xFF106FA3` now has a token (`primaryTextBg`); other one-off hero/brand hexes
  (gradients in Login/Home/Profile/Splash, gold `0xFFFFD60A`, `0xFFFFB800`) are
  decorative, left.

## Empty/error states worth a structured component (report only)

- `tasks/TasksScreen.kt:115` — lone `Text("Нет задач")` empty list.
- `chat/ChatScreen.kt:265` — lone `Text("Не удалось загрузить чат")` error.
- `supervisor/SupervisorScreen.kt:251` — lone hint `Text` for "no drops".
- `sales/AddSaleDialog.kt:208` — lone hint `Text` for empty metric selection.
No `EmptyState` component exists yet in `ui/components/` (recent UI/UX 3.0 work
added one elsewhere — not present here); building it is a structural decision.

## Verification

`JAVA_HOME=... ./gradlew :desktopApp:compileKotlin --console=plain -q` → clean,
no output (success).
