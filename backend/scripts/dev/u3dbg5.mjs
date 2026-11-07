import { chromium } from 'playwright';
const url = 'http://localhost:3071/#tgWebAppData=' + encodeURIComponent('user=' + encodeURIComponent(JSON.stringify({id:123456})));
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem('t2_theme','dark'); localStorage.setItem('t2_ui','beta'); } catch(e){} });
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
// trigger a real err toast + open sale sheet
const info = await p.evaluate(async () => {
  try { window.toast('Ошибка загрузки', 'err'); } catch(e){}
  await new Promise(r => setTimeout(r, 200));
  const t = document.querySelector('.toast');
  const cs = getComputedStyle(t);
  const rect = t.getBoundingClientRect();
  return { rect: { w: rect.width, h: rect.height, x: rect.x, y: rect.y }, top: cs.top, bottom: cs.bottom };
});
console.log(JSON.stringify(info, null, 1));
await p.screenshot({ path: process.argv[2] });
await b.close();
