// Temp verification script for UI3 supervisor layer — injects sv-*/cc-*
// markup into the live page (seeded user lacks supervisor role) and
// screenshots. Usage: node scripts/dev/svshot-tmp.mjs <theme> <out.png> [mode]
// mode: overview (default) | gate | access | cc
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const theme = args[0] || 'dark';
const out = args[1] || 'shot.png';
const mode = args[2] || 'overview';
const tgUser = JSON.stringify({ id: 123456, first_name: 'Иван', last_name: 'Иванов' });
const url = 'http://localhost:3071/#tgWebAppData=' + encodeURIComponent('user=' + encodeURIComponent(tgUser));
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
await ctx.addInitScript((t) => { try { localStorage.setItem('t2_theme', t); localStorage.setItem('t2_ui', 'beta'); } catch (_) {} }, theme);
const p = await ctx.newPage();
p.on('pageerror', () => {});
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
// splash can stick if boot was rate-limited — force it away for the shot
await p.evaluate(() => {
  const s = document.getElementById('appSplash');
  if (s) s.style.display = 'none';
});
// neuter the app's own renders so a late-failing supervisor API call
// can't overwrite the injected markup after we place it
await p.evaluate(() => {
  window.loadSupervisorData = () => {};
  window.renderSvAll = () => {};
  window.svDashData = { stub: true };
  // command-center + access render their own error-state over injected
  // markup when the (unauthorised) API call rejects — neuter them too so
  // the injected DOM survives to the screenshot
  window.loadCommandCenterPage = () => {};
  window.loadAccessRequests = () => {};
});
await p.waitForTimeout(800);
await p.evaluate(({ md, th }) => {
  document.body.setAttribute('data-theme', th);
  if (md === 'gate') {
    window.showLoginGate && window.showLoginGate('register');
    return;
  }
  if (md === 'access') {
    window.switchPage && window.switchPage('access');
    const box = document.getElementById('accessList');
    if (box) box.innerHTML = `
      <div class="progress-block" style="margin:8px 12px">
        <div class="row-title">Кузнецов Артём</div>
        <div class="row-sub">TG 555123 · Точка Невский, с 10.11</div>
        <select style="margin-top:8px;width:100%"><option selected>Продавец</option><option>Старший</option></select>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn-main" style="flex:1">Подтвердить</button>
          <button class="btn-main" style="flex:1;background:var(--danger)">Отклонить</button>
        </div>
      </div>
      <div class="progress-block" style="margin:8px 12px">
        <div class="row-title">Смирнова Ольга</div>
        <div class="row-sub">Тел. +79001112233</div>
        <select style="margin-top:8px;width:100%"><option selected>Продавец</option></select>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn-main" style="flex:1">Подтвердить</button>
          <button class="btn-main" style="flex:1;background:var(--danger)">Отклонить</button>
        </div>
      </div>`;
    return;
  }
  if (md === 'cc') {
    window.switchPage && window.switchPage('command-center');
    const box = document.getElementById('ccPageBody');
    if (box) box.innerHTML = `
      <div class="section">
        <div class="section-title">Что происходит</div>
        <div class="cc-row" style="padding:0 16px">
          <div class="cc-health mid">72</div>
          <div class="cc-meta">
            <div class="cc-line"><b>78%</b> план дня · 34 на смене · 12 точек</div>
            <div class="cc-line cc-down">-6% к темпу дня</div>
          </div>
        </div>
        <div class="workspace-grid" style="padding:10px 16px 0">
          <div class="progress-block" style="margin-bottom:8px;border-left:4px solid #2AABEE">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong>ТЦ Галерея</strong><span style="font-weight:700">62%</span>
            </div>
            <div style="font-size:12px;color:var(--hint);margin-top:4px">4 на смене · SIM 18/29 · MNP 4/10</div>
          </div>
          <div class="progress-block" style="margin-bottom:8px;border-left:4px solid #3FC07A">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong>Невский 112</strong><span style="font-weight:700">91%</span>
            </div>
            <div style="font-size:12px;color:var(--hint);margin-top:4px">3 на смене · SIM 20/22 · MNP 6/7</div>
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">Где проблема (2)</div>
        <div class="workspace-grid" style="padding:0 16px 16px">
          <div class="sv-drop" style="margin:8px 0 0">
            <div class="ico"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/></svg></div>
            <div style="flex:1">
              <div class="t">ТЦ Галерея</div>
              <div class="s">План дня провален</div>
              <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                <button class="mchip">Открыть точку</button>
                <button class="mchip">Создать задачу</button>
                <button class="mchip">Взять в работу</button>
              </div>
            </div>
          </div>
          <div class="sv-drop warn" style="margin:8px 0 0">
            <div class="ico"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div>
            <div style="flex:1">
              <div class="t">Южный Полюс</div>
              <div class="s">Ниже темпа по MNP</div>
            </div>
          </div>
        </div>
      </div>`;
    return;
  }
  // overview default — sv shell + all four bodies; mode can retarget
  // which sv tab ends active after injection
  const svTab = md === 'stores' ? 'sv-stores' : md === 'people' ? 'sv-people' : md === 'trend' ? 'sv-trend' : 'sv-overview';
  window.switchPage && window.switchPage(svTab);
  const sv = document.getElementById('bottomNavSupervisor');
  const mn = document.getElementById('bottomNavMain');
  if (sv) sv.style.display = 'flex';
  if (mn) mn.style.display = 'none';
  const hColor = '#F5A524';
  const ob = document.getElementById('svOverviewBody');
  if (ob) ob.innerHTML = `
    <div class="sv-hero">
      <div class="sv-kicker">Supervisor · T2 Analytics</div>
      <div class="sv-title">Сектор под контролем</div>
      <div class="sv-sub">07.11.2026 · 12 точек · на смене 34</div>
      <div class="sv-health-row">
        <div class="sv-ring" style="--sv-p:72;--sv-h:${hColor}"><span style="color:${hColor}">72</span></div>
        <div class="sv-metrics">
          <div class="sv-metric"><div class="n">78%</div><div class="l">План дня</div></div>
          <div class="sv-metric"><div class="n">63%</div><div class="l">Прогресс дня</div></div>
          <div class="sv-metric"><div class="n">41/55</div><div class="l">SIM</div></div>
          <div class="sv-metric"><div class="n">12/20</div><div class="l">MNP</div></div>
        </div>
      </div>
      <div class="sv-pace">
        <span>Темп: <b class="behind">-6% к темпу дня</b></span>
        <span>Просадки: <b>3</b></span>
      </div>
    </div>
    <div class="sv-section">Просадки и риски <span>· live</span></div>
    <div class="workspace-grid">
      <div class="sv-drop">
        <div class="ico"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/></svg></div>
        <div style="flex:1">
          <div class="t">ТЦ Галерея</div>
          <div class="s">План дня провален · 24% плана</div>
          <div class="s" style="margin-top:4px;font-style:italic"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="12" x="4" y="8" rx="2"/></svg> Мало продавцов на вечерней смене</div>
          <button class="mchip" style="margin-top:6px">Предложить перенос</button>
        </div>
      </div>
      <div class="sv-drop warn">
        <div class="ico"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div>
        <div style="flex:1"><div class="t">Невский 112</div><div class="s">Ниже темпа по MNP · 48% плана</div></div>
      </div>
    </div>`;
  const sb = document.getElementById('svStoresBody');
  if (sb) sb.innerHTML = `
    <div class="sv-store" style="--sc:#2AABEE">
      <div class="sv-store-head">
        <div>
          <div class="sv-store-name">ТЦ Галерея</div>
          <div class="sv-store-org">Сеть «Гелиос»</div>
          <div class="sv-store-code">SPB-014 · на смене 4</div>
        </div>
        <div class="sv-badge mid">62%</div>
      </div>
      <div class="sv-bars">
        <div class="sv-bar-row"><div>SIM</div><div class="sv-bar-track"><div class="sv-bar-fill" style="width:62%;background:#FF9F0A"></div></div><div style="text-align:right">18/29</div></div>
        <div class="sv-bar-row"><div>MNP</div><div class="sv-bar-track"><div class="sv-bar-fill" style="width:40%;background:#FF453A"></div></div><div style="text-align:right">4/10</div></div>
        <div class="sv-bar-row"><div>ПА</div><div class="sv-bar-track"><div class="sv-bar-fill" style="width:100%;background:#30D158"></div></div><div style="text-align:right">21/20</div></div>
      </div>
      <div class="mt-more"><button type="button" class="sv-toggle">Ещё метрики ▾</button><div class="sv-extra" id="svst-0"></div></div>
      <div class="sv-staff"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> Иван, Мария, Олег, Анна</div>
      <div style="font-size:11px;color:#FF9F0A;margin-top:4px">• Нет старшего после 18:00</div>
    </div>`;
  const pb = document.getElementById('svPeopleBody');
  if (pb) pb.innerHTML = [
    ['Петрова Мария', 'Сеть «Гелиос»', 1, 'SIM 9 · MNP 3 · ПА 12 · score 94'],
    ['Иванов Иван', 'Сеть «Гелиос»', 2, 'SIM 8 · MNP 2 · ПА 10 · score 88'],
    ['Сидоров Олег', 'Север', 3, 'SIM 7 · MNP 2 · ПА 8 · score 81'],
    ['Ким Анна', 'Юг', 4, 'SIM 6 · MNP 1 · ПА 7 · score 74']
  ].map(e => '<div class="sv-rank"><div class="pos ' + (e[2] < 4 ? 'gold' : '') + '">' + e[2] + '</div><div class="body"><div class="name">' + e[0] + '</div><div class="org">' + e[1] + '</div><div class="sub">' + e[3] + '</div></div></div>').join('');
  const tb = document.getElementById('svTrendBody');
  if (tb) tb.innerHTML = `
    <div class="sv-chart">
      <svg viewBox="0 0 320 100" preserveAspectRatio="none">
        <defs><linearGradient id="svFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8B5CF6" stop-opacity=".35"/><stop offset="100%" stop-color="#8B5CF6" stop-opacity="0"/></linearGradient></defs>
        <path d="M8,60 L35,50 L62,55 L89,40 L116,44 L143,30 L170,36 L197,25 L224,32 L251,20 L278,26 L312,92 L8,92 Z" fill="url(#svFill)"/>
        <path d="M8,60 L35,50 L62,55 L89,40 L116,44 L143,30 L170,36 L197,25 L224,32 L251,20 L278,26" fill="none" stroke="#8B5CF6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="278" cy="26" r="3.5" fill="#fff" stroke="#8B5CF6" stroke-width="2"/>
      </svg>
      <div class="sv-chart-legend"><span><i style="background:#8B5CF6"></i>Units / день</span><span>с 24.10.2026 по 07.11.2026</span></div>
    </div>
    <div class="sv-section">Месячный план — весь сектор <span>· выполнено сейчас: 58%</span></div>
    <div class="sv-store" style="--sc:#2AABEE"><div class="sv-bars">
      <div class="sv-bar-row"><div>SIM</div><div class="sv-bar-track"><div class="sv-bar-fill" style="width:58%;background:#FF9F0A"></div></div><div style="text-align:right">312/540</div></div>
      <div class="sv-bar-row"><div>MNP</div><div class="sv-bar-track"><div class="sv-bar-fill" style="width:44%;background:#FF453A"></div></div><div style="text-align:right">88/200</div></div>
    </div></div>`;
}, { md: mode, th: theme });
await p.waitForTimeout(400);
await p.screenshot({ path: out, fullPage: true });
console.log('saved', out);
await browser.close();
