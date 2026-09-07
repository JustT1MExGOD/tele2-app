import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks the `electron` module so createMainWindow() can be exercised in
// plain Vitest (no real Electron runtime needed) while still asserting
// against the REAL exported function's behavior, not just source text —
// the mock BrowserWindow constructor captures exactly the options object
// passed at the real call site.
const capturedOptions: any[] = [];
const capturedWindowListeners: Array<{ event: string; handler: (...args: any[]) => void }> = [];
const setApplicationMenuCalls: any[] = [];

vi.mock('electron', () => {
  class MockBrowserWindow {
    webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    constructor(options: any) {
      capturedOptions.push(options);
    }
    on(event: string, handler: (...args: any[]) => void) {
      capturedWindowListeners.push({ event, handler });
    }
  }
  return {
    BrowserWindow: MockBrowserWindow,
    Menu: {
      setApplicationMenu: (menu: any) => {
        setApplicationMenuCalls.push(menu);
      }
    },
    shell: { openExternal: vi.fn() }
  };
});

describe('createMainWindow — webPreferences hardening (DESK-01,02,03,04,09)', () => {
  beforeEach(() => {
    capturedOptions.length = 0;
    capturedWindowListeners.length = 0;
    vi.resetModules();
  });

  it('sets every mandated hardening flag, and never the forbidden ones', async () => {
    const { createMainWindow } = await import('../src/main/window.js');
    createMainWindow();
    expect(capturedOptions).toHaveLength(1);
    const { webPreferences } = capturedOptions[0];

    // DESK-01 nodeIntegration=false
    expect(webPreferences.nodeIntegration).toBe(false);
    // DESK-02 contextIsolation=true
    expect(webPreferences.contextIsolation).toBe(true);
    // sandbox=true (§4)
    expect(webPreferences.sandbox).toBe(true);
    // webSecurity=true (§4, DESK-09 TLS/mixed-content posture depends on this)
    expect(webPreferences.webSecurity).toBe(true);
    // DESK-09-adjacent: never silently allow insecure content over a
    // secure page.
    expect(webPreferences.allowRunningInsecureContent).toBe(false);

    // Forbidden flags must never appear as `true` (or at all) in the
    // object — this is the actual object passed to `new BrowserWindow`,
    // not source text, so there's no way to "comment around" this check.
    expect(webPreferences.nodeIntegrationInWorker).not.toBe(true);
    expect(webPreferences.nodeIntegrationInSubFrames).not.toBe(true);
    expect(webPreferences.enableRemoteModule).not.toBe(true);
    expect(webPreferences.webSecurity).not.toBe(false);
  });

  it('uses the dedicated persist:t2-sales partition, never the default session', async () => {
    const { createMainWindow, SESSION_PARTITION } = await import('../src/main/window.js');
    expect(SESSION_PARTITION).toBe('persist:t2-sales');
    createMainWindow();
    expect(capturedOptions[0].webPreferences.partition).toBe('persist:t2-sales');
  });

  it('sets a preload script (the only bridge into the renderer)', async () => {
    const { createMainWindow } = await import('../src/main/window.js');
    createMainWindow();
    expect(capturedOptions[0].webPreferences.preload).toBeTruthy();
    expect(String(capturedOptions[0].webPreferences.preload)).toMatch(/preload[\\/]index\.[jt]s$/);
  });

  it('20.56.7: locks the window title to "T2 Sales" by preventing page-title-updated sync, regardless of what document.title/branding sets', async () => {
    const { createMainWindow } = await import('../src/main/window.js');
    createMainWindow();

    const titleListener = capturedWindowListeners.find((l) => l.event === 'page-title-updated');
    expect(titleListener).toBeTruthy();

    const preventDefault = vi.fn();
    // Simulate the frontend setting document.title = 'РТТ Бижонов Sales'
    // (org-branded value) — Electron's default behavior would sync this
    // onto the native window/taskbar title unless prevented here.
    titleListener!.handler({ preventDefault }, 'РТТ Бижонов Sales');
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('20.56.7 — production app has no File/Edit/View/Window application menu (DESK-menu)', () => {
  beforeEach(() => {
    setApplicationMenuCalls.length = 0;
    vi.resetModules();
  });

  it('disableApplicationMenu() removes the menu object entirely via Menu.setApplicationMenu(null), never autoHideMenuBar', async () => {
    const { disableApplicationMenu } = await import('../src/main/menu.js');
    disableApplicationMenu();
    expect(setApplicationMenuCalls).toEqual([null]);
  });

  it('menu.ts source never uses autoHideMenuBar — Alt would restore a merely-hidden default menu on Windows, whereas setApplicationMenu(null) leaves nothing to restore', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'main', 'menu.ts'), 'utf8');
    // Strip comments first — the file's own docblock legitimately explains
    // WHY autoHideMenuBar is avoided (mentioning the term as prose), same
    // self-referential-comment trap guarded against elsewhere in this file;
    // only actual code should trip this check.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/autoHideMenuBar/);
    expect(code).toMatch(/Menu\.setApplicationMenu\(\s*null\s*\)/);
  });

  it('index.ts wires disableApplicationMenu() before the window is created', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
    const menuCallIdx = src.indexOf('disableApplicationMenu()');
    const windowCallIdx = src.indexOf('createMainWindow()');
    expect(menuCallIdx).toBeGreaterThan(-1);
    expect(windowCallIdx).toBeGreaterThan(-1);
    expect(menuCallIdx).toBeLessThan(windowCallIdx);
  });
});

describe('window.ts source — no forbidden Electron flags anywhere in this module (defense in depth alongside the object-shape test above)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'main', 'window.ts'), 'utf8');

  it('never sets nodeIntegration/contextIsolation/webSecurity to the insecure value', () => {
    expect(src).not.toMatch(/nodeIntegration\s*:\s*true/);
    expect(src).not.toMatch(/contextIsolation\s*:\s*false/);
    expect(src).not.toMatch(/webSecurity\s*:\s*false/);
    expect(src).not.toMatch(/sandbox\s*:\s*false/);
  });

  it('DESK-09 never disables TLS verification anywhere in the desktop app', () => {
    const srcDir = path.join(import.meta.dirname, '..', 'src');
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : entry.name.endsWith('.ts') ? [full] : [];
      });
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const file of walk(srcDir)) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(code, `${file} must not disable TLS verification`).not.toMatch(/rejectUnauthorized\s*:\s*false/);
      expect(code, `${file} must not ignore certificate errors`).not.toMatch(/setCertificateVerifyProc/);
    }
  });
});

describe('§6 preload API surface — no generic OS-capability channels', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const preloadSrc = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'preload', 'index.ts'), 'utf8');
  const contractSrc = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'shared', 'ipc-contract.ts'), 'utf8');

  it('DESK-03/04 preload never references fs/child_process/net directly', () => {
    expect(preloadSrc).not.toMatch(/require\(['"]fs['"]\)/);
    expect(preloadSrc).not.toMatch(/require\(['"]child_process['"]\)/);
    expect(preloadSrc).not.toMatch(/require\(['"]net['"]\)/);
    expect(preloadSrc).not.toMatch(/\bexec\(|\bspawn\(|\breadFile\(|\bwriteFile\(|\bopenSocket\(/);
  });

  it('no generic invoke(command, args) escape hatch exists in the IPC contract', () => {
    // Strip comments first — this file's own docblock legitimately
    // mentions the forbidden pattern as prose explaining the rule (same
    // self-referential-comment trap as relay/tests/relay-tls.test.ts);
    // only actual code should trip this check.
    const code = contractSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/invoke\s*\(\s*command/i);
    expect(code).not.toMatch(/genericInvoke|runCommand|execute\(/i);
  });
});

describe('20.56.7 — desktop theme resolves from the app\'s own data-theme, not prefers-color-scheme alone (network indicator theme fix)', () => {
  it('resolveDesktopTheme() normalizes the app\'s real data-theme value', async () => {
    const { resolveDesktopTheme } = await import('../src/preload/electron-visual-tokens.js');
    expect(resolveDesktopTheme('dark')).toBe('dark');
    expect(resolveDesktopTheme('light')).toBe('light');
  });

  it('resolveDesktopTheme() falls back to null (caller uses prefers-color-scheme) for unknown/unset values, never guesses', async () => {
    const { resolveDesktopTheme } = await import('../src/preload/electron-visual-tokens.js');
    expect(resolveDesktopTheme(null)).toBeNull();
    expect(resolveDesktopTheme(undefined)).toBeNull();
    expect(resolveDesktopTheme('')).toBeNull();
    expect(resolveDesktopTheme('sepia')).toBeNull();
  });
});

describe('20.56.7 — network status indicator mounts into the stable header location, not a hard-coded fixed offset (displaced-overlay fix)', () => {
  it('pickMountStrategy() prefers the header when .header-actions exists', async () => {
    const { pickMountStrategy } = await import('../src/preload/network-overlay.js');
    expect(pickMountStrategy(true)).toBe('header');
  });

  it('pickMountStrategy() only falls back to the fixed-position overlay when the header markup is absent', async () => {
    const { pickMountStrategy } = await import('../src/preload/network-overlay.js');
    expect(pickMountStrategy(false)).toBe('fixed-fallback');
  });
});
