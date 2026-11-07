import { chromium } from 'playwright';
const url = 'http://localhost:3071/#tgWebAppData=' + encodeURIComponent('user=' + encodeURIComponent(JSON.stringify({id:123456})));
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem('t2_theme','dark'); localStorage.setItem('t2_ui','beta'); } catch(e){} });
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const info = await p.evaluate(() => {
  const t = document.querySelector('.toast');
  const cs = getComputedStyle(t);
  // strip transform by cloning without transform
  const c = t.cloneNode();
  c.textContent = 'Тестовая ошибка загрузки';
  c.style.cssText += ';position:static!important;transform:none!important;opacity:1!important;visibility:visible!important;';
  document.body.appendChild(c);
  const cr = c.getBoundingClientRect();
  c.remove();
  return {
    top: cs.top, left: cs.left, bottom: cs.bottom, right: cs.right,
    transform: cs.transform, position: cs.position,
    contentText: t.textContent, innerH: t.innerHTML.length,
    scrollH: t.scrollHeight, scrollW: t.scrollWidth, offH: t.offsetHeight, offW: t.offsetWidth,
    noTransformRect: { w: cr.width, h: cr.height }
  };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
