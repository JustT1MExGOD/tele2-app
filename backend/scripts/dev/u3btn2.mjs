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
  let anc = []; let n = btn;
  for (let i=0;i<8 && n;i++){ anc.push({tag:n.tagName,id:n.id,cls:(n.className||'').toString().slice(0,40),du:n.getAttribute&&n.getAttribute('data-ui')}); n=n.parentElement; }
  // matching rules
  const matched = [];
  for (const s of document.styleSheets){ try{ for(const r of s.cssRules){ if(r.selectorText && btn.matches(r.selectorText.replace(/body\[data-ui="beta"\]\s*/,''))) matched.push({sel:r.selectorText,br:r.style.borderRadius,file:s.href}); }}catch(e){} }
  return { found:true, dataUi:document.body.getAttribute('data-ui'), matched, anc };
});
console.log(JSON.stringify(info,null,1));
await b.close();
