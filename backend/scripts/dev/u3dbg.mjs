import { chromium } from 'playwright';
const url = 'http://localhost:3071/#tgWebAppData=' + encodeURIComponent('user=' + encodeURIComponent(JSON.stringify({id:123456})));
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem('t2_theme','dark'); localStorage.setItem('t2_ui','beta'); } catch(e){} });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e));
p.on('response', r => { if (r.status() >= 400) errs.push('HTTP ' + r.status() + ' ' + r.url()); });
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
const res = await p.evaluate(async () => {
  try { await window.openAddSale(1); return 'opened'; }
  catch (e) { return 'THROWN: ' + (e && e.message || e); }
});
const toast = await p.evaluate(() => {
  const t = document.querySelector('.toast, #toast, [class*="toast"]');
  return t ? { cls: t.className, style: t.getAttribute('style'), rect: t.getBoundingClientRect().toJSON(), html: t.outerHTML.slice(0, 300) } : null;
});
console.log('openAddSale ->', res);
console.log('toast ->', JSON.stringify(toast, null, 1));
console.log('--- errors ---'); console.log(errs.slice(0, 15).join('\n'));
await b.close();
