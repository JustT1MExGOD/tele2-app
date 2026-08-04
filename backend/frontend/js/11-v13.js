/* 11-v13.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== V13: смена / инсайт / live / quick sale =====
    async function geoCoords() {
      try {
        const pos = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000 })
        );
        return {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy
        };
      } catch (_) {
        return { lat: null, lng: null, accuracy_m: null };
      }
    }

    function openComboCalc() {
      document.getElementById('modalTitle').textContent = 'Расчёт комбо';
      document.getElementById('modalBody').innerHTML = `
        <div class="empty" style="text-align:left;padding:0 0 12px;line-height:1.45">
          Формула T2:<br><b>цена − скидка% + 28% от цены + 1900</b>
        </div>
        <div class="field">
          <label>Цена телефона, ₽</label>
          <input type="number" id="comboPrice" placeholder="29990" inputmode="decimal">
        </div>
        <div class="field">
          <label>Скидка, %</label>
          <input type="number" id="comboDiscount" value="0" inputmode="decimal">
        </div>
        <button type="button" class="btn-main" onclick="runComboCalc()">Посчитать</button>
        <div id="comboOut" style="display:none" class="combo-result"></div>
      `;
      try {
        if (typeof openModal === 'function') openModal();
        else document.getElementById('overlay')?.classList.add('show');
      } catch (e) {
        console.error(e);
        document.getElementById('overlay')?.classList.add('show');
      }
      setTimeout(() => document.getElementById('comboPrice')?.focus(), 200);
    }

    function runComboCalc() {
      const price = Number(document.getElementById('comboPrice')?.value) || 0;
      const disc = Number(document.getElementById('comboDiscount')?.value) || 0;
      if (price <= 0) { toast('Укажи цену', 'err'); return; }
      const afterDisc = price * (1 - disc / 100);
      const total = Math.round(afterDisc + price * 0.28 + 1900);
      const el = document.getElementById('comboOut');
      if (!el) return;
      el.style.display = 'block';
      el.innerHTML = `
        <div class="big">${total.toLocaleString('ru-RU')} ₽</div>
        <div class="hint">
          ${price.toLocaleString('ru-RU')} − ${disc}% = ${Math.round(afterDisc).toLocaleString('ru-RU')}<br>
          + 28% (${Math.round(price * 0.28).toLocaleString('ru-RU')}) + 1 900
        </div>`;
      try { tg?.HapticFeedback?.impactOccurred?.('light'); } catch (_) {}
    }

    async function openShiftSession() {
      try {
        const geo = await geoCoords();
        const res = await fetch(API + '/shifts/open', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify(geo)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || data.message || 'fail');
        toast('Смена открыта', 'ok');
        try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch (_) {}
        loadMyPlan();
      } catch (e) {
        toast(e.message || 'Не удалось открыть смену', 'err');
      }
    }

    async function closeShiftSession() {
      // prompt() в Telegram WebView часто не работает — своя модалка
      document.getElementById('modalTitle').textContent = 'Закрыть смену';
      document.getElementById('modalBody').innerHTML = `
        <div class="field"><label>Самоотчёт (что зашло / что мешало)</label>
          <textarea id="closeReport" rows="3" placeholder="Кратко…"></textarea></div>
        <div class="field"><label>Настроение 1–5</label>
          <input type="number" id="closeMood" min="1" max="5" value="4"></div>
        <button type="button" class="btn-main" style="background:#e74c3c" onclick="confirmCloseShift()">Закрыть смену</button>
      `;
      openModal();
    }

    async function confirmCloseShift() {
      const report = document.getElementById('closeReport')?.value || '';
      const mood = Math.min(5, Math.max(1, Number(document.getElementById('closeMood')?.value) || 4));
      try {
        const geo = await geoCoords();
        const res = await fetch(API + '/shifts/close', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({ ...geo, self_report: report, mood })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || 'fail');
        try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch (_) {}
        if (data.ideal_shift || (data.plan_pct >= 100)) {
          try { confettiBurst && confettiBurst(); } catch (_) {}
        }
        showShiftResult(data);
        if (typeof loadMyPlan === 'function') loadMyPlan();
      } catch (e) {
        toast(e.message || 'Не удалось закрыть смену', 'err');
      }
    }

    // ===== SHIFT RESULT (14.6) =====
    // Разбор смены вместо голой галочки "идеальная / не идеальная":
    // факт/план по метрикам, чего не хватило, XP и уровень за эту смену.
    function showShiftResult(data) {
      const fact = data.fact || {};
      const plan = data.day_plan || {};
      const gam = data.gamification || {};
      const missing = data.ideal_missing || [];

      document.getElementById('modalTitle').textContent = data.ideal_shift ? '⭐ Идеальная смена' : 'Смена закрыта';
      document.getElementById('modalBody').innerHTML = `
        <div style="text-align:center;padding:4px 0 16px">
          <div style="font-size:36px;font-weight:800;line-height:1">${data.score ?? 0}</div>
          <div style="font-size:12px;color:var(--hint);margin-top:2px">итоговый score</div>
        </div>
        ${['sim', 'mnp', 'pa', 'combo'].map(m => {
          const labels = { sim: 'SIM', mnp: 'MNP', pa: 'ПА', combo: 'Комбо' };
          return progressHTML(labels[m], fact[m], plan[m]);
        }).join('')}
        ${!data.ideal_shift && missing.length ? `
          <div class="empty" style="text-align:left;padding:10px 0 0;font-size:12px">
            До идеальной смены: ${esc(missing.join(', '))}
          </div>` : ''}
        <div class="progress-block" style="margin-top:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div>
              <div style="font-weight:700">${esc(gam.title || '')} · ур. ${gam.level || 1}</div>
              <div style="font-size:12px;color:var(--hint)">${gam.xp || 0} XP${gam.next_level_xp != null ? ' / ' + gam.next_level_xp : ''}${gam.leveled_up ? ' · 🎉 новый уровень!' : ''}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-weight:700;color:var(--success)">+${gam.xp_gained || 0} XP</div>
              ${gam.streak_days ? `<div style="font-size:12px;color:var(--hint)">🔥 ${gam.streak_days} дн.</div>` : ''}
            </div>
          </div>
        </div>
        <button class="btn-main" style="margin-top:14px" onclick="closeModal()">Понятно</button>
      `;
      if (typeof openModal === 'function') openModal();
      else document.getElementById('overlay')?.classList.add('show');
    }

    async function loadShiftAndInsight(empId) {
      const shiftEl = document.getElementById('lkShift');
      const insightEl = document.getElementById('lkInsight');
      const gamEl = document.getElementById('lkGamification');
      if (shiftEl) shiftEl.innerHTML = '';
      if (insightEl) insightEl.innerHTML = '';
      if (gamEl) gamEl.innerHTML = '';

      try {
        const [curRes, insRes, selfRes] = await Promise.all([
          fetch(API + '/shifts/current', { headers: authHeaders() }),
          fetch(API + '/me/insight', { headers: authHeaders() }),
          fetch(API + '/me/self-stats', { headers: authHeaders() })
        ]);
        const cur = curRes.ok ? await curRes.json() : {};
        const ins = insRes.ok ? await insRes.json() : {};
        const self = selfRes.ok ? await selfRes.json() : {};

        if (shiftEl) {
          const sess = cur.session;
          if (sess) {
            shiftEl.innerHTML = `
              <div class="progress-block" style="margin-bottom:12px">
                <div class="section-title" style="margin-bottom:8px">Смена открыта</div>
                <div style="font-size:13px;color:var(--hint);margin-bottom:10px">
                  ${sess.store_name || sess.store_id} · с ${String(sess.opened_at || '').slice(11, 16) || '—'} МСК
                </div>
                <button class="btn-main" style="background:#e74c3c" onclick="closeShiftSession()">Закрыть смену</button>
              </div>`;
          } else {
            shiftEl.innerHTML = `
              <div class="progress-block" style="margin-bottom:12px">
                <div class="section-title" style="margin-bottom:8px">Смена</div>
                <div style="font-size:13px;color:var(--hint);margin-bottom:10px">Открой смену на точке — зафиксируем время и гео</div>
                <button class="btn-main" onclick="openShiftSession()">Открыть смену</button>
              </div>`;
          }
        }

        if (insightEl && ins.insight) {
          const i = ins.insight;
          const focus = (i.focus || []).map(f => `<div style="font-size:12px;margin-top:4px">• ${f}</div>`).join('');
          const split = i.split;
          let splitHtml = '';
          if (split?.before_lunch && split?.after_lunch) {
            splitHtml = `<div style="margin-top:10px;font-size:12px;color:var(--hint)">
              До 15:00: SIM ${split.before_lunch.sim || 0} · MNP ${split.before_lunch.mnp || 0}<br>
              После: SIM ${split.after_lunch.sim || 0} · MNP ${split.after_lunch.mnp || 0}
            </div>`;
          }
          insightEl.innerHTML = `
            <div class="progress-block" style="margin-bottom:12px">
              <div class="section-title" style="margin-bottom:8px">Фокус сейчас</div>
              <div style="font-size:14px;line-height:1.4">${i.message || ''}</div>
              ${focus}${splitHtml}
            </div>`;
        }

        if (gamEl && self.gamification) {
          const g = self.gamification;
          const best = self.best_shift;
          gamEl.innerHTML = `
            <div class="progress-block" style="margin-bottom:12px">
              <div class="section-title" style="margin-bottom:8px">Прогресс</div>
              <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:13px">
                <div class="lk-pill">lvl <strong>${g.level || 1}</strong> ${g.title || ''}</div>
                <div class="lk-pill">XP <strong>${g.xp || 0}</strong>${g.next_level_xp != null ? ' / ' + g.next_level_xp : ''}</div>
                <div class="lk-pill">🔥 <strong>${g.streak_days || 0}</strong> дн.</div>
              </div>
              ${best ? `<div style="margin-top:8px;font-size:12px;color:var(--hint)">Лучшая смена: ${best.date} · score ${best.score}</div>` : ''}
            </div>`;
        }
      } catch (e) {
        console.error('shift/insight', e);
      }
    }

    // hook into loadMyPlan: call after profile rendered
    const _loadMyPlanOrig = typeof loadMyPlan === 'function' ? loadMyPlan : null;
    // We call loadShiftAndInsight from patched actions - inject call via monkey after empId known
    // Patch: after bindSec hide, when we have empId, call loadShiftAndInsight

    async function openQuickSale() {
      document.getElementById('modalTitle').textContent = 'Быстрый ввод';
      document.getElementById('modalBody').innerHTML = `
        <div class="empty" style="text-align:left;padding:0 0 12px">
          Пример: <b>две симки и одно mnp</b> · <b>3 sim 1 па</b>
        </div>
        <div class="field">
          <label>Фраза</label>
          <input id="quickSaleText" placeholder="две симки одно mnp" />
        </div>
        <div id="quickSalePreview" class="empty" style="display:none;text-align:left"></div>
        <button class="btn-main" onclick="submitQuickSale()">Разобрать и записать</button>
        <button class="btn-ghost" style="margin-top:8px;width:100%" onclick="previewQuickSale()">Только разобрать</button>
      `;
      try {
        if (typeof openModal === 'function') openModal();
        else document.getElementById('overlay')?.classList.add('show');
      } catch (_) {
        document.getElementById('overlay')?.classList.add('show');
      }
      setTimeout(() => document.getElementById('quickSaleText')?.focus(), 200);
    }

    async function previewQuickSale() {
      const text = document.getElementById('quickSaleText')?.value || '';
      const res = await fetch(API + '/sales/parse', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      const el = document.getElementById('quickSalePreview');
      if (!el) return;
      el.style.display = 'block';
      const m = data.metrics || {};
      const keys = Object.keys(m);
      el.textContent = keys.length
        ? keys.map(k => k + ': ' + m[k]).join(', ') + ' · confidence ' + Math.round((data.confidence || 0) * 100) + '%'
        : 'Не разобрано';
    }

    async function submitQuickSale() {
      const text = document.getElementById('quickSaleText')?.value || '';
      if (!text.trim()) { toast('Введи фразу', 'err'); return; }
      try {
        const res = await fetch(API + '/sales/quick', {
          method: 'POST', headers: authHeaders(true),
          body: JSON.stringify({ text })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'fail');
        closeModal();
        const m = data.parsed?.metrics || {};
        toast('Записано: ' + Object.keys(m).map(k => k + ' ' + m[k]).join(', '), 'ok');
        loadPage(page);
      } catch (e) {
        toast(e.message || 'Ошибка', 'err');
      }
    }

    async function loadLiveMap() {
      const box = document.getElementById('liveList');
      const meta = document.getElementById('liveMeta');
      if (box) box.innerHTML = '<div class="skeleton"></div>';
      try {
        const res = await fetch(API + '/network/live', { headers: authHeaders() });
        if (!res.ok) throw new Error('fail');
        const data = await res.json();
        if (meta) meta.textContent = 'Дата: ' + (data.date || todayMoscow()) + ' · обновление при открытии экрана';
        const stores = data.stores || [];
        if (!stores.length) {
          box.innerHTML = '<div class="empty">Нет точек</div>';
          return;
        }
        box.innerHTML = stores.map(st => {
          const statusColor = st.status === 'critical' ? '#e74c3c' : st.status === 'warn' ? '#f39c12' : '#2ecc71';
          const staff = (st.staff || []).map(s => s.short_name || s.full_name || s.employee_id).join(', ') || 'никого';
          const cash = st.cash
            ? `Касса Δ ${st.cash.delta}`
            : 'Касса —';
          return `
            <div class="progress-block" style="margin-bottom:10px;border-left:4px solid ${st.color || statusColor}">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <strong>${st.name}</strong>
                <span style="color:${statusColor};font-weight:700">${st.plan_pct || 0}%</span>
              </div>
              <div style="font-size:12px;color:var(--hint);margin-top:4px">
                ${staff}<br>
                SIM ${st.fact?.sim || 0}/${st.plan?.sim || 0} · MNP ${st.fact?.mnp || 0}/${st.plan?.mnp || 0}<br>
                ${cash}
              </div>
            </div>`;
        }).join('');
      } catch (e) {
        console.error(e);
        if (box) box.innerHTML = '<div class="empty">Нужен API /network/live (V13)</div>';
      }
    }

    function confettiBurst() {
      // лёгкий confetti без библиотек
      const colors = ['#6d9eeb', '#ff6d01', '#ffd966', '#2ecc71', '#e74c3c'];
      for (let i = 0; i < 24; i++) {
        const el = document.createElement('div');
        el.style.cssText = `position:fixed;top:-10px;left:${Math.random()*100}%;width:8px;height:8px;background:${colors[i%colors.length]};border-radius:2px;z-index:9999;pointer-events:none;animation:t2fall ${1+Math.random()}s linear forwards`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2000);
      }
    }

    // CSS fall
    (function(){
      if (document.getElementById('t2-v13-style')) return;
      const s = document.createElement('style');
      s.id = 't2-v13-style';
      s.textContent = '@keyframes t2fall{to{transform:translateY(100vh) rotate(360deg);opacity:0}}';
      document.head.appendChild(s);
    })();


    
