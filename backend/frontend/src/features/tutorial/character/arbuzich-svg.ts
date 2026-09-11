/**
 * Production Арбузыч renderer (§3) — a layered inline SVG (body + stripe +
 * two eyes + mouth + brows), swappable per character state entirely via
 * CSS custom-property-free class selectors on these named parts (see
 * styles.css's .arb-* rules) — NOT a sprite sheet, NOT a new runtime
 * dependency. Kept in its own tiny module so the actual character art can
 * be swapped in later (a real illustration, Lottie file, etc.) by
 * replacing only this function's return value — nothing in
 * arbuzich-controller.ts or any course/engine code references SVG markup
 * directly.
 */
export function arbuzichSvgMarkup(): string {
  return `
    <svg class="arb-svg" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="academyArbGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#8bd96b" />
          <stop offset="100%" stop-color="#3f9e4d" />
        </linearGradient>
      </defs>
      <circle class="arb-body" cx="32" cy="32" r="26" />
      <path class="arb-stripe" d="M8 24 Q32 14 56 24 Q32 20 8 24 Z" />
      <path class="arb-stripe" d="M6 40 Q32 50 58 40 Q32 46 6 40 Z" />
      <line class="arb-brow" x1="16" y1="20" x2="24" y2="18" />
      <line class="arb-brow" x1="48" y1="20" x2="40" y2="18" />
      <ellipse class="arb-eye" cx="22" cy="28" rx="3.4" ry="4.2" />
      <ellipse class="arb-eye" cx="42" cy="28" rx="3.4" ry="4.2" />
      <path class="arb-mouth" d="M 24 42 Q 32 42 40 42" />
    </svg>`;
}
