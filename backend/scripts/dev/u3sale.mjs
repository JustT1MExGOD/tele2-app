import { chromium } from 'playwright';
const url = 'http://localhost:3071/#tgWebAppData=' + encodeURIComponent('user=' + encodeURIComponent(JSON.stringify({id:123456})));
const b = await chromium.launch({ channel: 'chrome' });
for (const theme of ['dark','light']) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await c.addInitScript(([t]) => { try { localStorage.setItem('t2_theme',t); localStorage.setItem('t2_ui','beta'); } catch(e){} }, [theme]);
  const p = await c.newPage();
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  await p.evaluate(async () => { await window.openAddSale(1); });
  await p.waitForTimeout(2500);
  const out = `C:/Users/shywh/AppData/Local/Temp/f-sale-${theme}.png`;
  await p.screenshot({ path: out });
  console.log('saved', out);
  await c.close();
}
await b.close();
