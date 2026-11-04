# T2 Miranda — UI/UX 3.0 consistency pass

Scope: `native/mirandaApp` (Compose Desktop). Token source:
`native/shared/.../theme/T2Tokens.kt` (`T2Colors`/`T2Radius`/`T2Spacing`/`T2FontSize`).
Reference implementation: `native/desktopApp` (miranda was ported from it).

## Changed

- `ui/chat/MirandaChatScreen.kt:309` — disabled send-icon tint `T2Colors.hint` →
  `T2Colors.textSecondary` (matches desktop `ChatScreen.kt:362`).
- `ui/chat/MirandaChatScreen.kt:351` — attachment size caption `hint` →
  `textSecondary` (matches desktop `ChatScreen.kt:433`).
- `ui/chat/MirandaChatScreen.kt:369` — pending-status label `hint` →
  `textSecondary` (matches desktop `ChatScreen.kt:452`).
- `ui/chat/MirandaChatScreen.kt:230` — failed-state text `hint` → `textSecondary`
  (matches desktop `ChatScreen.kt:265`).
- `ui/chat/MirandaChatScreen.kt:260` — attachment-chip remove `×`: split `"  ×"`
  leading-space hack into `start=6.dp` padding, enlarged the click target
  (trailing `horizontal=2.dp` inside the click region).
- `ui/settings/MirandaSettingsScreen.kt:137,152` — inline `presenceError` /
  `displayNameError` text `T2Colors.text` → `T2Colors.danger` (consistent with
  `DeviceActivationScreen.kt:82` error styling).
- `ui/conversations/ContactsTreeScreen.kt:128` — contacts `loadError` text
  `T2Colors.text` → `T2Colors.danger`.
- `ui/conversations/ContactsTreeScreen.kt:199-208,355-378,404-417` — icon-only
  glyph controls (`+` add group, `+` add subgroup, `⋯` manage group, `⋯` manage
  contact): added `4.dp` padding inside the `pointerInput` tap region so the hit
  target isn't just the 14.sp glyph.
- `Main.kt:319` — chat-header `✕` close: padding moved before `clickable` so the
  hit region grows around the glyph (previously `clickable` then `end=12.dp`
  padding shrank the target to the glyph).

## Deliberately left

- `ui/login/LoginScreen.kt:86,110-111` — raw `Color(0xFF0E2230)` /
  `0xFFDCEFFA` hero gradient + alpha-white card overlay: decorative brand
  gradient on a fixed dark gate, theme tokens would change appearance (same
  category as desktop's hero gradients left in `native-desktop.md`).
- `ui/components/Motion.kt:97` — `Color(0x22FFFFFF)` shimmer sweep: an alpha
  light-sweep, not a semantic color.
- Raw `.dp` off the 4/8 rhythm (`10`, `14`, `18`, `22`, `6`, `9`) — all mirror
  `desktopApp`'s own histogram (14.dp field radius, 10.dp gaps, 6.dp chips);
  swapping to `T2Spacing`/`T2Radius` tokens here would *create* divergence with
  the sibling client rather than remove it. Mass-change, reported not done.
- Offline presence dot `T2Colors.hint` (`ContactsTreeScreen.kt:398`) — a
  deliberately dimmed "not online" marker, consistent with messenger
  conventions.
- `DeviceActivationScreen.kt:124` account-switcher card `RoundedCornerShape(14)`
  vs `MirandaAdminScreen.kt` list cards `RoundedCornerShape(12)` — the 14dp card
  matches the form-control radius (Field/MainButton); which radius "wins" is a
  design call, left.
- `Field(label=…)` renders its uppercase label unconditionally — callers that
  pass `""` (e.g. `MirandaAdminScreen.kt:323` StepUp code) still get an empty
  label row + 6.dp gap. Shared-component change; desktop's `Field` is identical,
  so fixing only miranda's would diverge them. Report.
- No `EmptyState`/`EmptyBlock` component exists here; the lone-text empty states
  ("Нет контактов", "Корпоративных аккаунтов пока нет", etc.) are candidates for
  the same structured component flagged in `native-desktop.md`.
- Icon-only glyph controls (`+`, `⋯`, `✕`, `×`, `▾/▸`) are `Text`+`clickable`,
  not `Icon`+`contentDescription` — Compose Desktop screen-reader coverage for
  clickable-text semantics is thin; the real `Icon` composables
  (attach/send in the composer) already carry `contentDescription`. A full
  a11y pass (semantics on every glyph-button) is a separate structural item.

## Verification

`cd native && JAVA_HOME="C:/Users/shywh/tools/jdk-17.0.20.1+1"
./gradlew :mirandaApp:compileKotlin --console=plain` → BUILD SUCCESSFUL
(1 executed, 4 up-to-date).
