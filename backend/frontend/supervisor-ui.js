
    function svTone(pct) {
      if (pct >= 85) return 'good';
      if (pct >= 50) return 'mid';
      return 'bad';
    }
    function svBarColor(pct) {
      if (pct >= 100) return '#30D158';
      if (pct >= 50) return '#FF9F0A';
      return '#FF453A';
    }
    function svHealthColor(h) {
      if (h >= 75) return '#30D158';
      if (h >= 45) return '#FF9F0A';
      return '#FF453A';
    }

    function sparklineSVG(trend, key = 'units') {
      if (!trend || !trend.length) return '<div class="empty" style="padding:12px">Нет ряда</div>';
      const vals = trend.map(t => Number(t[key]) || 0);
      const max = Math.max(1, ...vals);
      const w = 320, h = 100, pad = 8;
      const step = (w - pad * 2) / Math.max(1, vals.length - 1);
      const pts = vals.map((v, i) => {
        const x = pad + i * step;
        const y = h - pad - (v / max) * (h - pad * 2);
        return [x, y];
      });
      const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      const area = line + ` L${pts[pts.length-1][0]},${h-pad} L${pts[0][0]},${h-pad} Z`;
      return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="svFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2AABEE" stop-opacity=".35"/>
            <stop offset="100%" stop-color="#2AABEE" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#svFill)"/>
        <path d="${line}" fill="none" stroke="#2AABEE" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${pts.length ? `<circle cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="3.5" fill="#fff" stroke="#2AABEE" stroke-width="2"/>` : ''}
      </svg>`;
    }

    async function loadSupervisorDash() {
      const box = document.getElementById('supervisorBody');
      if (!box) return;
      box.innerHTML = '<div class="skeleton" style="margin:16px"></div><div class="skeleton" style="margin:16px;height:120px"></div>';
      try {
        const res = await fetch(API + '/supervisor/dashboard?days=14', { headers: authHeaders() });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || ('HTTP ' + res.status));
        }
        const d = await res.json();
        const net = d.network || {};
        const health = Number(net.health) || 0;
        const hColor = svHealthColor(health);
        const pace = Number(net.pace_delta) || 0;
        const paceClass = pace >= 0 ? 'ahead' : 'behind';
        const paceText = pace >= 0 ? ('+' + pace + '% к темпу дня') : (pace + '% к темпу дня');

        let html = `
          <div class="sv-hero">
            <div class="sv-kicker">Supervisor · T2 Analytics</div>
            <div class="sv-title">Сеть под контролем</div>
            <div class="sv-sub">${d.date || ''} · ${net.stores_count || 0} точек · на смене ${net.staff_on_shift || 0}</div>
            <div class="sv-health-row">
              <div class="sv-ring" style="--sv-p:${health};--sv-h:${hColor}"><span style="color:${hColor}">${health}</span></div>
              <div class="sv-metrics">
                <div class="sv-metric"><div class="n">${net.overall_pct || 0}%</div><div class="l">План дня</div></div>
                <div class="sv-metric"><div class="n">${net.day_progress_pct || 0}%</div><div class="l">Прогресс дня</div></div>
                <div class="sv-metric"><div class="n">${net.sim || 0}/${net.plan_sim || 0}</div><div class="l">SIM</div></div>
                <div class="sv-metric"><div class="n">${net.mnp || 0}/${net.plan_mnp || 0}</div><div class="l">MNP</div></div>
              </div>
            </div>
            <div class="sv-pace">
              <span>Темп: <b class="${paceClass}">${paceText}</b></span>
              <span>Просадки: <b>${net.drops_count || 0}</b></span>
            </div>
          </div>
        `;

        // drops
        html += `<div class="sv-section">Просадки и риски <span>· live</span></div>`;
        if ((d.drops || []).length) {
          html += d.drops.map(x => `
            <div class="sv-drop ${x.severity === 'critical' ? '' : 'warn'}">
              <div class="ico">${x.severity === 'critical' ? '🚨' : '⚠️'}</div>
              <div>
                <div class="t">${x.store_name || 'Точка'}</div>
                <div class="s">${x.message}${x.overall != null ? ' · ' + x.overall + '% плана' : ''}</div>
              </div>
            </div>`).join('');
        } else {
          html += `<div class="empty" style="padding:12px 16px">Критических просадок нет — сеть в ритме</div>`;
        }

        // trend chart
        html += `
          <div class="sv-section">Динамика 14 дней <span>· units (SIM+MNP+ПА+Комбо)</span></div>
          <div class="sv-chart">
            ${sparklineSVG(d.trend || [], 'units')}
            <div class="sv-chart-legend">
              <span><i style="background:#2AABEE"></i>Units / день</span>
              <span>с ${d.from || ''} по ${d.date || ''}</span>
            </div>
          </div>
        `;

        // stores
        html += `<div class="sv-section">Точки <span>· сортировка: слабые сверху</span></div>`;
        html += (d.stores || []).map(s => {
          const t = s.today || {};
          const o = Number(t.overall) || 0;
          const badge = svTone(o);
          const bars = [
            { l: 'SIM', f: t.sim, p: t.plan_sim, pc: t.pct_sim },
            { l: 'MNP', f: t.mnp, p: t.plan_mnp, pc: t.pct_mnp },
            { l: 'ПА', f: t.pa, p: t.plan_pa, pc: t.pct_pa }
          ].map(b => {
            const pc = Number(b.pc) || 0;
            return `<div class="sv-bar-row">
              <div>${b.l}</div>
              <div class="sv-bar-track"><div class="sv-bar-fill" style="width:${Math.min(100,pc)}%;background:${svBarColor(pc)}"></div></div>
              <div style="text-align:right">${b.f||0}/${b.p||0}</div>
            </div>`;
          }).join('');
          const staff = (s.staff || []).map(x => x.name.split(' ')[0]).join(', ') || '—';
          const alerts = (s.alerts || []).map(a => `<div style="font-size:11px;color:#FF9F0A;margin-top:4px">• ${a}</div>`).join('');
          return `<div class="sv-store" style="--sc:${s.color || '#2AABEE'}">
            <div class="sv-store-head">
              <div>
                <div class="sv-store-name">${s.name}</div>
                <div class="sv-store-code">${s.code || ''} · на смене ${s.staff_count || 0}</div>
              </div>
              <div class="sv-badge ${badge}">${o}%</div>
            </div>
            <div class="sv-bars">${bars}</div>
            <div class="sv-staff">👥 ${staff}</div>
            ${alerts}
          </div>`;
        }).join('') || '<div class="empty">Нет точек</div>';

        // top
        html += `<div class="sv-section">Топ продавцов <span>· ${d.from || ''}–${d.date || ''}</span></div>`;
        html += (d.top_employees || []).map((e, i) => `
          <div class="sv-rank">
            <div class="pos ${i < 3 ? 'gold' : ''}">${e.rank || i + 1}</div>
            <div class="body">
              <div class="name">${e.full_name}</div>
              <div class="sub">SIM ${e.sim} · MNP ${e.mnp} · ПА ${e.pa} · score ${e.score}</div>
            </div>
          </div>`).join('') || '<div class="empty">Нет продаж за период</div>';

        html += `<div style="height:24px"></div>`;
        box.innerHTML = html;
      } catch (e) {
        console.error(e);
        box.innerHTML = `<div class="empty">Кабинет супервайзера недоступен<br><span style="font-size:12px;opacity:.7">${e.message || e}</span>
          <br><span style="font-size:11px;opacity:.5">Нужен API /supervisor/dashboard</span></div>`;
      }
    }
