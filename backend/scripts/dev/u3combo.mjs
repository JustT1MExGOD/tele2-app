import { chromium } from 'playwright';
const url = 'http://localhost:3071/#tgWebAppData=' + encodeURIComponent('user=' + encodeURIComponent(JSON.stringify({id:123456})));
const b = await chromium.launch({ channel: 'chrome' });
for (const [fn,name,idv,runf] of [['openComboCalc','combo','#comboPrice','runComboCalc'],['openSchoolCalc','school','#schoolPrice','runSchoolCalc']]) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await c.addInitScript(() => { try { localStorage.setItem('t2_theme','dark'); localStorage.setItem('t2_ui','beta'); } catch(e){} });
  const p = await c.newPage();
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  await p.evaluate((f) => window[f] && window[f](), fn);
  await p.waitForTimeout(1500);
  await p.fill(idv, '29990');
  await p.evaluate((f) => window[f] && window[f](), runf);
  await p.waitForTimeout(600);
  await p.screenshot({ path: `C:/Users/shywh/AppData/Local/Temp/m-${name}.png` });
  console.log('saved', name);
  await c.close();
}
await b.close();
