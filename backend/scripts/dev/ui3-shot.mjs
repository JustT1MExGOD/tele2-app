// Usage: node shot.mjs <page> <out.png> [--theme dark|light] [--ui beta|legacy] [--full] [--eval "js"]
// Opens the real app on the local dev server (localhost:3071) as the seeded
// test employee (telegram id 123456), switches to <page> and screenshots at
// iPhone size. Run from backend/ so playwright resolves.
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const page = args[0] || 'home';
const out = args[1] || 'shot.png';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const theme = opt('theme', 'dark');
const ui = opt('ui', 'beta');
const full = args.includes('--full');
const evalJs = opt('eval', '');
const tgUser = JSON.stringify({ id: 123456, first_name: 'Иван', last_name: 'Иванов' });
const url = 'http://localhost:3071/#tgWebAppData=' + encodeURIComponent('user=' + encodeURIComponent(tgUser));
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
await ctx.addInitScript(([t, u]) => { try { localStorage.setItem('t2_theme', t); localStorage.setItem('t2_ui', u); } catch (_) {} }, [theme, ui]);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
if (page !== 'home') { await p.evaluate((pg) => window.switchPage && window.switchPage(pg), page); await p.waitForTimeout(1500); }
if (evalJs) { await p.evaluate(evalJs); await p.waitForTimeout(1200); }
await p.screenshot({ path: out, fullPage: full });
if (errors.length) console.log('console errors:\n' + errors.slice(0, 10).join('\n'));
console.log('saved', out);
await browser.close();
