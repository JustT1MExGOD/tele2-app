/**
 * 20.12.0 (Frontend rewrite kickoff) — typed page registry, replacing the
 * pattern where every page is a global `loadXPage()` function wired by hand
 * into 02-nav-utils.js's loadPage() if-chain. Migrated pages register here
 * instead of growing that if-chain further.
 *
 * Deliberately NOT URL/hash-based: this is a Telegram Mini App with no
 * server-side routes and no bookmarkable-URL use case (Telegram's own
 * deep-linking uses start_param, not paths) — introducing browser history/
 * hash routing here would be complexity with no real consumer. The actual
 * "current page" concept (the `page-<name>` DOM convention, bottom-nav
 * active state, FAB visibility) still lives in 02-nav-utils.js's
 * switchPage() — this registry is the render-dispatch layer underneath it,
 * not a replacement for it.
 *
 * Bridge for this pilot: a migrated page module registers here AND assigns
 * `window.loadXPage = () => renderPage('x')`, so the existing legacy
 * dispatch keeps working completely unchanged. Once enough pages migrate,
 * loadPage()'s if-chain can collapse to a single `hasPage(name)` check —
 * not done now, that's a legacy-file edit for a later version.
 */
type PageRenderer = () => void | Promise<void>;

const registry = new Map<string, PageRenderer>();

export function registerPage(name: string, render: PageRenderer): void {
  if (registry.has(name)) {
    console.warn(`registerPage: "${name}" уже зарегистрирована, перезаписываю`);
  }
  registry.set(name, render);
}

export function hasPage(name: string): boolean {
  return registry.has(name);
}

export function renderPage(name: string): void | Promise<void> {
  const render = registry.get(name);
  if (!render) {
    throw new Error(`renderPage: страница "${name}" не зарегистрирована`);
  }
  return render();
}
