import { chromium } from 'playwright';
const url = 'http://localhost:3071/#tgWebAppData=' + encodeURIComponent('user=' + encodeURIComponent(JSON.stringify({id:123456})));
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem('t2_theme','light'); localStorage.setItem('t2_ui','beta'); } catch(e){} });
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.evaluate(() => window.switchPage && window.switchPage('my'));
await p.waitForTimeout(2500);
const info = await p.evaluate(() => {
  const all = [...document.querySelectorAll('.btn-main')];
  const vis = all.filter(b => b.getBoundingClientRect().width > 0);
  const btn = vis.find(b => b.textContent.includes('Открыть смену')) || vis[0];
  if (!btn) return { found:false, count: all.length, texts: all.slice(0,6).map(x=>x.textContent.trim()) };
  const hits=[];
  for (const s of document.styleSheets){ try{ for(const r of s.cssRules){ if(r.selectorText && r.style && r.style.borderRadius && btn.matches(r.selectorText)) hits.push({sel:r.selectorText.slice(0,70), br:r.style.borderRadius, file:(s.href||'inline').split('/').pop()}); }}catch(e){} }
  return { found:true, text:btn.textContent.trim(), cls:btn.className, inline:btn.getAttribute('style'), br:getComputedStyle(btn).borderRadius, hits };
});
console.log(JSON.stringify(info,null,1));
await b.close();
