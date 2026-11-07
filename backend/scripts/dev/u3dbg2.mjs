import { chromium } from 'playwright';
const url = 'http://localhost:3071/#tgWebAppData=' + encodeURIComponent('user=' + encodeURIComponent(JSON.stringify({id:123456})));
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem('t2_theme','dark'); localStorage.setItem('t2_ui','beta'); } catch(e){} });
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
const info = await p.evaluate(() => {
  const t = document.querySelector('.toast');
  const cs = getComputedStyle(t);
  return { display: cs.display, whiteSpace: cs.whiteSpace, width: cs.width, height: cs.height,
           writingMode: cs.writingMode, flexDir: cs.flexDirection, alignItems: cs.alignItems,
           padding: cs.padding, overflow: cs.overflow, textOverflow: cs.textOverflow,
           maxWidth: cs.maxWidth, boxSizing: cs.boxSizing, wordBreak: cs.wordBreak };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
