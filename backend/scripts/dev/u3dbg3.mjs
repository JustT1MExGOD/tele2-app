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
  const sheet = [];
  for (const s of document.styleSheets) {
    try { for (const r of s.cssRules) {
      if (r.selectorText && r.selectorText.includes('toast')) sheet.push({ sel: r.selectorText, css: r.style.cssText.slice(0,200), file: s.href });
    }} catch(e){}
  }
  return { parent: t.parentElement ? { id: t.parentElement.id, cls: t.parentElement.className, disp: getComputedStyle(t.parentElement).display, flexDir: getComputedStyle(t.parentElement).flexDirection } : null,
           htmlFontSize: getComputedStyle(document.documentElement).fontSize,
           vw: innerWidth,
           rules: sheet };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
