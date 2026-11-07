// Scrolls body (not viewport) in segments and saves each segment — the web app's
// old UI makes body itself the scroll container, so Playwright fullPage doesn't work.
import { chromium } from 'playwright';
import fs from 'node:fs';
const [page, out, theme] = process.argv.slice(2);
const url = 'http://localhost:3071/#tgWebAppData=' + encodeURIComponent('user=' + encodeURIComponent(JSON.stringify({id:123456})));
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(([t]) => { try { localStorage.setItem('t2_theme',t); localStorage.setItem('t2_ui','beta'); } catch(e){} }, [theme || 'dark']);
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
if (page !== 'home') { await p.evaluate(pg => window.switchPage && window.switchPage(pg), page); await p.waitForTimeout(1500); }
const scrollH = await p.evaluate(() => document.body.scrollHeight);
const shots = Math.ceil(scrollH / 844);
for (let i = 0; i < shots; i++) {
  await p.evaluate((y) => { document.body.scrollTop = y; }, i * 844);
  await p.waitForTimeout(400);
  fs.writeFileSync(out.replace('.png', `-${i}.png`), await p.screenshot());
}
console.log('saved', shots, 'to', out);
await b.close();
