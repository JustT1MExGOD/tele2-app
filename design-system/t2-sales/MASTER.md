# T2 Sales — Design System (UI/UX 3.0, epoch 21.0.0)

> Source of truth for the visual language across all four clients:
> web (`backend/frontend/styles.css`), native Windows (`native/desktopApp`),
> native Android (`native/androidApp`), Miranda (`native/mirandaApp`).
> Web tokens live in `:root`/`[data-theme]`; native mirrors them in
> `native/shared/.../T2Tokens.kt` — **the two must stay in sync.**

---

## Brand

- Product blue: `#2AABEE` (`--t2-blue` / `T2Colors.blue`), deep `#1A8FD1`
- Ink/black: `#0A0A0B` (`--t2-black`)
- Mascot mark: 🍉 (watermelon) — allowed as a *brand* accent in
  splash/gate/empty-states only, **never** as a UI control icon.
- Voice: clean, dense, dark-first productivity tool for a field-sales
  network. Calm surfaces, high-contrast metrics, zero decoration that
  doesn't carry meaning.

## Color tokens (semantic, theme-aware)

Light (`:root`) / dark (`[data-theme="dark"]`) pairs — **never hardcode a
hex in a component; always the token:**

| Role | Light | Dark | Usage |
|------|-------|------|-------|
| `--bg` | `#f4f4f6` | `#000000` | page background |
| `--surface` | `#ffffff` | `#141416` | cards, panels |
| `--surface-2` | `#f0f0f3` | `#1c1c1f` | inner chips, secondary panels |
| `--surface-3` | `#e8e8ed` | `#26262b` | pressed/track fills |
| `--text` | `#0a0a0b` | `#f5f5f7` | primary text |
| `--text-secondary` | `#5c5c66` | `#a1a1aa` | secondary text |
| `--hint` | `#6e6e78` | `#7e7e87` | captions, timestamps (≥4.5:1) |
| `--primary` | `#2aabee` | `#3bb8f5` | links, active states, brand actions |
| `--primary-soft` | 14% | 18% alpha | washes behind primary |
| `--success` | `#22c55e` | `#30d158` | ok / gained / done |
| `--warning` | `#f59e0b` | `#ff9f0a` | caution / pending |
| `--danger` | `#ef4444` | `#ff453a` | errors, destructive actions |
| `*-soft` | ~12–16% alpha | ~16% alpha | tinted chip/panel backgrounds |
| `--border` | 7% | ~8% alpha | hairline card borders |
| `--border-strong` | 12% | — | input/ghost-button borders |
| `--accent` | `#0a0a0b` | `#ffffff` | primary CTA fill (inverts w/ theme) |

Status rules: **success = `var(--success)`, danger = `var(--danger)`,
warning = `var(--warning)`, hint = `var(--hint)` — no raw hex.** (Fixed in
the 20.86 pass: six divergent hardcoded reds/greens/ambers.)

## Typography

- Family: system UI stack (`--font`), metrics in tabular figures where
  columns of numbers line up.
- Scale (`--fs-*`): xs 11 · sm 13 · md 15 · lg 17 · xl 20 · 2xl 24 · 3xl 28
- Weights: regular body / medium labels / bold (700) headings & numbers.
- Line-height `--lh` ~1.45, relaxed `--lh-relaxed` for multi-line copy.
- Headings: `letter-spacing:-0.01em`; section titles uppercase +0.06em.

## Spacing / radius / shadow

- Spacing scale `--sp-*`: 4 8 12 16 20 24 32 (`sp-1..sp-8`). All gaps,
  paddings, margins on this rhythm — no odd px like 7/9/13/17.
- Radius `--radius-*`: xs 8 · sm 12 · md 16 · (default) 20 · lg 24 ·
  xl 28 · full 999.
  - Cards/panels `.section` → `--radius` (20)
  - Buttons `.btn-main`/`.btn-ghost`, inputs → `--radius-md` (16)
  - Chips `.mchip`, small inner blocks → `--radius-sm` (12)
  - Pills, icon buttons → `--radius-full`
- Shadow scale: `--shadow-xs` (buttons) < `--shadow` (cards) < `--shadow-lg`
  (sheets/modals). Flat-first: shadows are subtle, never heavy.

## Components (web ↔ native parity)

| Element | Web | Native |
|---------|-----|--------|
| Primary CTA | `.btn-main` | `MainButton` |
| Secondary | `.btn-ghost` | `MChipButton` |
| Chip/tag | `.mchip` | `MChip` |
| Row item | `.row` / `.link-row` | `ListRow` |
| Card/panel | `.section` | `ResultCard`/`.section` equivalent |
| Toast | `.toast` (aria-live) | `Toaster`/`T2Toast` |
| Sheet/modal | `.sheet-modal` | `SheetDialog`/`BottomSheet` |

Rules for every component:
- One primary CTA per screen; secondary actions visually subordinate.
- Sibling controls share height/vertical padding (btn-main & btn-ghost = 15px).
- Press feedback within ~100ms (scale 0.94–0.98 or opacity shift), no layout shift.
- Disabled: opacity ~0.4 + `cursor:not-allowed`, non-interactive.
- Icons: SVG only (Lucide-style stroke set), `aria-hidden` when beside a
  visible label, accessible name when standalone.

## States (must exist on every screen)

- **Loading** — skeleton shimmer (`--surface-2/3`), not a bare spinner for >1s.
- **Empty** — helpful message + next action, hint color, centered.
- **Error** — danger color + concrete retry/recovery, never silent.
- **Offline** — persistent banner/badge, queue pending actions.
- **Success** — brief confirm (toast/check), no modals for trivial ops.

## Accessibility floor (non-negotiable)

- Contrast ≥4.5:1 body text, ≥3:1 large/UI — verified per theme.
- Touch targets ≥44px (web/Telegram) / 48dp (Android); expand hit-area
  beyond a smaller visual icon.
- `:focus-visible` 2–4px `--primary` ring, never removed.
- `prefers-reduced-motion`: collapse non-essential animation to opacity-only.
- Icon-only controls get `aria-label` / `contentDescription`.
- Toast/status regions: `role="status"` + `aria-live="polite"`.
- No horizontal scroll; content reflows at 375px.

## Anti-patterns (forbidden)

- Raw hex in components (always a token).
- Emoji as a UI control icon (brand mascot in empty/splash only).
- Ad-hoc px spacing off the 4/8 rhythm.
- Hover-only affordances (no title-only tooltips for meaning).
- Mismatched sibling control heights.
- Placeholder-as-label inputs; errors only at page top.

## Page overrides

Per-screen deviations live in `design-system/t2-sales/pages/<page>.md`.
Check it before building; if absent, this Master governs.
