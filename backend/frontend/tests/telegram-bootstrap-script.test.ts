/**
 * Telegram Mini App forced-to-phone-login regression — index.html's
 * inline bootstrap `<script>` (the one setting
 * window.__t2TelegramScriptSettled) is plain browser JS, not a
 * TypeScript module — this file extracts it VERBATIM from the real
 * index.html (same technique as desktop/scripts/verify-network-startup.mjs
 * uses for its own real-markup check) and evaluates it in a real jsdom
 * `window`, so these tests exercise the actual shipped script, not a
 * reimplementation that could silently drift from it.
 *
 * §Test D — "Telegram SDK temporary error then retry success -> Telegram
 * auth": the script now retries (bounded, 6 attempts) when the URL
 * confirms a real Telegram context, instead of giving up after one
 * failed/slow attempt. These tests control `document.createElement`
 * to intercept the script tag(s) it creates and fire onload/onerror
 * manually, with vitest fake timers standing in for the real 8s
 * per-attempt bound so the test itself runs in milliseconds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.join(__dirname, '..', 'index.html');

function extractBootstrapScript(): string {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const match = html.match(/<script>\s*window\.__t2TelegramScriptSettled[\s\S]*?<\/script>/);
  if (!match) throw new Error('could not find the __t2TelegramScriptSettled inline bootstrap script in index.html — has it moved/changed shape?');
  return match[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
}

const SCRIPT_SOURCE = extractBootstrapScript();

/** Fake <script> elements: createElement intercepts only script tags,
 * tracking each one so the test can fire its onload/onerror
 * deterministically instead of hitting a real network. Installed fresh
 * in beforeEach and torn down in afterEach (not manually at the end of
 * each test body) specifically so a failing/timing-out test still
 * restores the spy — otherwise the NEXT test's spy wraps an
 * already-mocked createElement, and a THIRD layer recurses infinitely. */
let fired: Array<{ el: any }> = [];
let createElementSpy: ReturnType<typeof vi.spyOn> | null = null;

function installFakeScriptElements(): void {
  fired = [];
  const realCreateElement = document.createElement.bind(document);
  createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreateElement(tag) as any;
    if (tag === 'script') {
      el.remove = vi.fn();
      fired.push({ el });
    }
    return el;
  });
}

describe('index.html inline Telegram bootstrap script — real markup, real retry logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (window as any).t2Desktop;
    delete (window as any).__t2TelegramScriptSettled;
    window.history.replaceState(null, '', '/');
    installFakeScriptElements();
  });
  afterEach(() => {
    createElementSpy?.mockRestore();
    createElementSpy = null;
    vi.useRealTimers();
  });

  function run(): void {
    // eslint-disable-next-line no-new-func
    new Function(SCRIPT_SOURCE).call(window);
  }

  it('desktop: resolves false immediately, never creates a script element at all — zero network request', async () => {
    (window as any).t2Desktop = {};
    run();
    const settled = await window.__t2TelegramScriptSettled;
    expect(settled).toBe(false);
    expect(fired.length).toBe(0);
  });

  it('plain web (no tgWebAppData in URL): a single failed attempt resolves false — no retry, matching the original bound', async () => {
    run();
    await vi.waitFor(() => expect(fired.length).toBe(1));
    fired[0].el.onerror();
    const settled = await window.__t2TelegramScriptSettled;
    expect(settled).toBe(false);
    expect(fired.length).toBe(1); // exactly one attempt — no retry for a non-Telegram context
  });

  it('§Test D — real Telegram context (tgWebAppData in URL): a temporary error is retried, and the retry succeeding resolves true', async () => {
    window.history.replaceState(null, '', '#tgWebAppData=user%3D%257B%2522id%2522%253A1%257D%26auth_date%3D1%26hash%3Dabc');
    run();

    await vi.waitFor(() => expect(fired.length).toBe(1));
    fired[0].el.onerror(); // first attempt fails (transient network error)

    await vi.waitFor(() => expect(fired.length).toBe(2));
    fired[1].el.onload(); // retry succeeds

    const settled = await window.__t2TelegramScriptSettled;
    expect(settled).toBe(true);
    expect(fired.length).toBe(2); // exactly one retry, not more
  });

  it('real Telegram context: retries are bounded, not infinite — gives up (resolves false) after the configured attempt count', async () => {
    window.history.replaceState(null, '', '#tgWebAppData=user%3D%257B%2522id%2522%253A1%257D%26auth_date%3D1%26hash%3Dabc');
    run();

    // Fail attempts one at a time until the script itself stops
    // creating new ones (proves it gave up), capped so a genuine
    // infinite-retry bug fails this test instead of hanging it.
    let i = 0;
    const hardCap = 20;
    while (i < hardCap) {
      await vi.waitFor(() => expect(fired.length).toBeGreaterThan(i));
      fired[i].el.onerror();
      i++;
      // Give any immediately-scheduled next attempt a chance to fire
      // before deciding whether the script created another one.
      await Promise.resolve();
      if (fired.length === i) break; // no new attempt was created — it gave up
    }

    const settled = await window.__t2TelegramScriptSettled;
    expect(settled).toBe(false);
    expect(fired.length).toBeGreaterThan(1); // did retry at least once
    expect(fired.length).toBeLessThan(hardCap); // but bounded, not unbounded
  });

  it('real Telegram context: a per-attempt timeout (no onload/onerror ever firing) also triggers a retry, not a permanent hang', async () => {
    window.history.replaceState(null, '', '#tgWebAppData=user%3D%257B%2522id%2522%253A1%257D%26auth_date%3D1%26hash%3Dabc');
    run();

    await vi.waitFor(() => expect(fired.length).toBe(1));
    // Neither onload nor onerror ever fires for the first attempt —
    // only the per-attempt timeout should move it forward.
    await vi.advanceTimersByTimeAsync(8100);
    await vi.waitFor(() => expect(fired.length).toBe(2));
    fired[1].el.onload();

    const settled = await window.__t2TelegramScriptSettled;
    expect(settled).toBe(true);
  });
});
