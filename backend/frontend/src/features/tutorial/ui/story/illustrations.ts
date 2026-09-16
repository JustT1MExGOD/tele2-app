/**
 * T2 Academy — original flat-vector scene illustrations (§ ASSET-LICENSES.md:
 * every shape here is authored inline as SVG path/geometry, no traced or
 * imported third-party artwork). Kept as pure string builders — story.css
 * owns all color/animation, these functions only own layout/geometry, so a
 * palette or motion change never requires touching markup.
 *
 * Style language: flat ink-outline silhouettes + one warm accent, layered
 * for parallax (sky/back building/mid props/foreground character) — the
 * *technique* borrowed from reviewing the brief's reference clip (bold
 * graphic-mask scene transitions, restrained palette, big flat shapes),
 * not any of its actual characters or logos.
 */

export type ScenePose = 'idle' | 'enter' | 'wave' | 'point' | 'talk' | 'think' | 'success' | 'mistake' | 'celebrate';

/** Арбузыч's face reuses the existing production SVG (character/arbuzich-svg.ts
 * parts) via arbFaceMarkup() from the caller — this file only draws the body/
 * limbs so the mascot's face stays a single source of truth across the app. */
export function arbuzychBodySvg(): string {
  return `
    <g class="story-arb-body">
      <path class="story-arb-robe" d="M -30 46 C -34 6 -22 -16 0 -16 C 22 -16 34 6 30 46 Z" />
      <path class="story-arb-robe-shade" d="M 0 -16 C 14 -16 24 -2 27 20 L -27 20 C -24 -2 -14 -16 0 -16 Z" opacity="0.16" />
      <ellipse class="story-arb-belt" cx="0" cy="30" rx="27" ry="5" />
      <g class="story-arb-arm-l"><path d="M -26 6 C -40 10 -46 24 -42 36" /></g>
      <g class="story-arb-arm-r"><path d="M 26 6 C 40 10 46 24 42 36" /></g>
    </g>`;
}

export function employeeFigureSvg(variant: 'walk' | 'idle' = 'idle'): string {
  return `
    <g class="story-employee ${variant === 'walk' ? 'story-employee-walk' : ''}">
      <ellipse class="story-figure-shadow" cx="0" cy="64" rx="22" ry="5" />
      <path class="story-figure-legs" d="M -10 30 L -14 62 L -4 62 L 0 34 L 4 62 L 14 62 L 10 30 Z" />
      <path class="story-figure-body" d="M -16 -4 C -16 -20 16 -20 16 -4 L 18 32 L -18 32 Z" />
      <g class="story-figure-arm-l"><path d="M -15 -2 C -26 4 -28 16 -24 26" /></g>
      <g class="story-figure-arm-r"><path d="M 15 -2 C 26 4 28 16 24 26" /></g>
      <circle class="story-figure-head" cx="0" cy="-30" r="13" />
      <path class="story-figure-hair" d="M -13 -33 C -13 -46 13 -46 13 -33 C 8 -38 -8 -38 -13 -33 Z" />
    </g>`;
}

export function customerFigureSvg(): string {
  return `
    <g class="story-customer">
      <ellipse class="story-figure-shadow" cx="0" cy="64" rx="20" ry="5" />
      <path class="story-figure-legs" d="M -9 28 L -12 62 L -3 62 L 0 32 L 3 62 L 12 62 L 9 28 Z" />
      <path class="story-figure-body story-customer-body" d="M -15 -2 C -15 -18 15 -18 15 -2 L 17 30 L -17 30 Z" />
      <g class="story-figure-arm-l"><path d="M -14 0 C -22 8 -22 18 -18 26" /></g>
      <g class="story-figure-arm-r"><path d="M 14 0 C 22 8 22 18 18 26" /></g>
      <circle class="story-figure-head" cx="0" cy="-28" r="12" />
      <path class="story-figure-hair story-customer-hair" d="M -12 -30 C -16 -40 16 -40 12 -30 C 12 -22 -12 -22 -12 -30 Z" />
    </g>`;
}

/** Wide establishing shot — the shop's storefront from the street, dawn sky. */
export function sceneShopExterior(): string {
  return `
    <svg class="story-scene-svg" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <rect class="story-sky" x="0" y="0" width="960" height="540" />
      <circle class="story-sun" cx="800" cy="120" r="70" />
      <path class="story-ground" d="M0 470 L960 470 L960 540 L0 540 Z" />
      <g class="story-parallax-back">
        <path class="story-building-far" d="M40 470 L40 280 L160 250 L280 280 L280 470 Z" />
        <path class="story-building-far" d="M680 470 L680 300 L800 270 L920 300 L920 470 Z" />
      </g>
      <g class="story-parallax-mid story-shop">
        <rect class="story-shop-wall" x="300" y="220" width="360" height="250" rx="6" />
        <rect class="story-shop-awning" x="284" y="205" width="392" height="34" rx="6" />
        <rect class="story-shop-door" x="440" y="330" width="80" height="140" rx="4" />
        <rect class="story-shop-window story-shop-window-l" x="320" y="260" width="90" height="90" rx="4" />
        <rect class="story-shop-window story-shop-window-r" x="550" y="260" width="90" height="90" rx="4" />
        <text class="story-shop-sign" x="480" y="200" text-anchor="middle">T2</text>
      </g>
      <g class="story-figure-slot story-figure-slot-employee" transform="translate(560,420)"></g>
      <g class="story-figure-slot story-figure-slot-arb" transform="translate(430,415)"></g>
    </svg>`;
}

/** Interior wide shot — counter, register terminal, shelving. */
export function sceneShopInterior(): string {
  return `
    <svg class="story-scene-svg" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <rect class="story-wall" x="0" y="0" width="960" height="540" />
      <rect class="story-floor" x="0" y="420" width="960" height="120" />
      <g class="story-parallax-back">
        <rect class="story-shelf" x="60" y="140" width="200" height="260" rx="8" />
        <rect class="story-shelf-line" x="60" y="200" width="200" height="6" />
        <rect class="story-shelf-line" x="60" y="260" width="200" height="6" />
        <rect class="story-shelf-line" x="60" y="320" width="200" height="6" />
        <rect class="story-window" x="700" y="90" width="200" height="180" rx="10" />
      </g>
      <g class="story-parallax-mid story-counter">
        <rect class="story-counter-body" x="330" y="330" width="420" height="110" rx="10" />
        <rect class="story-terminal" x="500" y="270" width="90" height="70" rx="8" />
        <rect class="story-terminal-screen" x="510" y="280" width="70" height="44" rx="4" />
      </g>
      <g class="story-figure-slot story-figure-slot-employee" transform="translate(430,410)"></g>
      <g class="story-figure-slot story-figure-slot-arb" transform="translate(620,415)"></g>
    </svg>`;
}

/** Push-in on the store nameplate/counter — pairs with the DISCOVER step. */
export function sceneStoreCloseup(): string {
  return `
    <svg class="story-scene-svg" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <rect class="story-wall" x="0" y="0" width="960" height="540" />
      <rect class="story-floor" x="0" y="420" width="960" height="120" />
      <g class="story-parallax-mid story-counter story-counter-close">
        <rect class="story-counter-body" x="180" y="300" width="600" height="160" rx="14" />
        <rect class="story-nameplate" x="360" y="230" width="240" height="70" rx="10" />
        <text class="story-nameplate-text" x="480" y="273" text-anchor="middle">ТВОЯ ТОЧКА</text>
      </g>
      <g class="story-figure-slot story-figure-slot-arb" transform="translate(770,415)"></g>
    </svg>`;
}

/** Two shops connected by a dotted route — pairs with the replacement PRACTICE step. */
export function sceneRoute(): string {
  return `
    <svg class="story-scene-svg" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <rect class="story-sky story-sky-dusk" x="0" y="0" width="960" height="540" />
      <path class="story-ground" d="M0 470 L960 470 L960 540 L0 540 Z" />
      <g class="story-parallax-mid">
        <rect class="story-shop-wall story-shop-a" x="90" y="300" width="180" height="170" rx="6" />
        <rect class="story-shop-awning" x="78" y="288" width="204" height="24" rx="6" />
        <rect class="story-shop-wall story-shop-b" x="690" y="270" width="180" height="200" rx="6" />
        <rect class="story-shop-awning" x="678" y="258" width="204" height="24" rx="6" />
        <path class="story-route-line" d="M280 460 C 460 410, 560 410, 690 440" />
        <circle class="story-route-dot" cx="360" cy="437" r="6" />
        <circle class="story-route-dot" cx="470" cy="415" r="6" />
        <circle class="story-route-dot" cx="580" cy="418" r="6" />
      </g>
      <g class="story-figure-slot story-figure-slot-employee" transform="translate(380,415)"></g>
      <g class="story-figure-slot story-figure-slot-arb" transform="translate(310,415)"></g>
    </svg>`;
}

/** Warm celebratory wide shot — pairs with chapter-complete cutscenes. */
export function sceneCelebration(): string {
  return `
    <svg class="story-scene-svg" viewBox="0 0 960 540" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <rect class="story-sky story-sky-celebrate" x="0" y="0" width="960" height="540" />
      <circle class="story-sun story-sun-celebrate" cx="480" cy="150" r="90" />
      <path class="story-ground" d="M0 470 L960 470 L960 540 L0 540 Z" />
      <g class="story-parallax-mid story-shop">
        <rect class="story-shop-wall" x="300" y="230" width="360" height="240" rx="6" />
        <rect class="story-shop-awning" x="284" y="215" width="392" height="30" rx="6" />
        <text class="story-shop-sign" x="480" y="210" text-anchor="middle">T2</text>
      </g>
      <g class="story-confetti-slot"></g>
      <g class="story-figure-slot story-figure-slot-arb" transform="translate(480,420)"></g>
    </svg>`;
}

export function transitionWipeSvg(): string {
  return `
    <svg class="story-wipe-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path class="story-wipe-shape" d="M -5 -5 L 40 -5 L 30 50 L 45 105 L -5 105 Z" />
    </svg>`;
}
