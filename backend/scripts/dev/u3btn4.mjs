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
  const btn = [...document.querySelectorAll('.btn-main')].find(b => b.offsetParent!==null);
  const res = { found: !!btn };
  if (!btn) return res;
  res.inlineBr = btn.style.borderRadius;
  res.bodyBeta = document.body.matches('[data-ui="beta"]');
  res.hasCls = btn.classList.contains('btn-main');
  res.matchesScoped = btn.matches('body[data-ui="beta"] .btn-main');
  const hits=[];
  for (const s of document.styleSheets){ try{ for(const r of s.cssRules){ if(r.selectorText && r.selectorText.includes('.btn-main')) hits.push({sel:r.selectorText, br:r.style.borderRadius, file:(s.href||'inline').split('/').pop()}); }}catch(e){} }
  res.rules = hits;
  return res;
});
console.log(JSON.stringify(info,null,1));
await b.close();
