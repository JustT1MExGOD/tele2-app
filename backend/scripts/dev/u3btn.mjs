import { chromium } from 'playwright';
const url = 'http://localhost:3071/#tgWebAppData=' + encodeURIComponent('user=' + encodeURIComponent(JSON.stringify({id:123456})));
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem('t2_theme','light'); localStorage.setItem('t2_ui','beta'); } catch(e){} });
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.evaluate(() => window.switchPage && window.switchPage('my'));
await p.waitForTimeout(1500);
const info = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('.btn-main')].find(b => b.textContent.includes('Открыть смену'));
  if (!btn) return { found: false };
  const cs = getComputedStyle(btn);
  return { found: true, br: cs.borderRadius, rules: 'check' };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
