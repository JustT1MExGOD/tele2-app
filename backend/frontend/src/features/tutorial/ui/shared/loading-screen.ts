/**
 * Academy entry cinematic — reflects real preload readiness, never an
 * artificial delay (see final report's loading-behavior section). Shows
 * for at least MIN_MS (so it reads as a deliberate transition, not a
 * flash) and for at most as long as the real progress fetch actually
 * takes — if the fetch is instant, this still shows briefly and moves on;
 * if the fetch is slow, this waits for it rather than faking readiness.
 */
const MIN_MS = 450;

export function renderLoadingScreen(root: HTMLElement): void {
  root.className = 'academy-shell academy-loading';
  root.innerHTML = `
    <div class="academy-loading-bg"></div>
    <div class="academy-loading-content">
      <div class="academy-loading-logo">T2 ACADEMY</div>
      <div class="academy-loading-tagline">Твоя история начинается здесь</div>
      <div class="academy-loading-mascot"></div>
      <div class="academy-loading-bar"><div class="academy-loading-bar-fill"></div></div>
    </div>`;
}

export async function withLoadingScreen<T>(root: HTMLElement, load: () => Promise<T>): Promise<T> {
  renderLoadingScreen(root);
  const started = performance.now();
  const [result] = await Promise.all([load(), sleep(0)]);
  const elapsed = performance.now() - started;
  if (elapsed < MIN_MS) await sleep(MIN_MS - elapsed);
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
