/**
 * SVG + PNG отчёт дня (тот же набор метрик, что в чате)
 */
import { query } from '../db/index.js';

function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function num(v: any) {
  return Number(v) || 0;
}

export async function loadFactPlanStaff(storeId: string, date: string) {
  const storeRes = await query(`SELECT id, name, code FROM stores WHERE id = $1`, [storeId]).catch(
    () => ({ rows: [] as any[] })
  );
  const st = storeRes.rows[0] || { name: storeId, code: '' };

  const salesRes = await query(
    `SELECT
        COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp, COALESCE(SUM(pa),0) pa,
        COALESCE(SUM(combo),0) combo, COALESCE(SUM(phones),0) phones,
        COALESCE(SUM(accessories),0) accessories, COALESCE(SUM(settings),0) settings,
        COALESCE(SUM(insurance),0) insurance, COALESCE(SUM(wink),0) wink,
        COALESCE(SUM(shpd),0) shpd, COALESCE(SUM(focus),0) focus,
        COALESCE(SUM(credit_request),0) credit_request,
        COALESCE(SUM(credit_issued),0) credit_issued,
        COALESCE(SUM(plotter),0) plotter, COALESCE(SUM(hb),0) hb
     FROM sales WHERE store_id = $1 AND sale_date::date = $2::date`,
    [storeId, date]
  ).catch(() => ({ rows: [{}] }));
  const f = salesRes.rows[0] || {};

  let planRes = await query(
    `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date::date = $2::date LIMIT 1`,
    [storeId, date]
  ).catch(() => ({ rows: [] as any[] }));
  if (!planRes.rows[0]) {
    planRes = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL LIMIT 1`,
      [storeId]
    ).catch(() => ({ rows: [] as any[] }));
  }
  const p = planRes.rows[0] || {};

  const staffRes = await query(
    `SELECT e.full_name FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE sch.store_id = $1 AND sch.work_date::date = $2::date AND COALESCE(sch.hours,0)>0
     ORDER BY e.full_name`,
    [storeId, date]
  ).catch(() => ({ rows: [] as any[] }));

  return { st, f, p, staff: staffRes.rows.map((r: any) => r.full_name as string) };
}

export type ReportKind = 'micro' | 'final';

export async function buildDailyReportSvg(
  storeId: string,
  date: string,
  opts?: { kind?: ReportKind; hourLabel?: string }
) {
  const kind = opts?.kind || 'final';
  const { st, f, p, staff } = await loadFactPlanStaff(storeId, date);

  const groups: { title: string; rows: [string, number, number][] }[] =
    kind === 'micro'
      ? [
          {
            title: 'Факт / план',
            rows: [
              ['SIM', num(f.sim), num(p.sim)],
              ['MNP', num(f.mnp), num(p.mnp)],
              ['ПА', num(f.pa), num(p.pa)],
              ['Комбо', num(f.combo), num(p.combo)],
              ['Телефоны', num(f.phones), num(p.phones)],
              ['Аксы', num(f.accessories), num(p.accessories)],
              ['Wink', num(f.wink), num(p.wink)],
              ['ШПД', num(f.shpd), num(p.shpd)]
            ]
          }
        ]
      : [
          {
            title: 'Блок GI',
            rows: [
              ['Симкарты', num(f.sim), num(p.sim)],
              ['MNP', num(f.mnp), num(p.mnp)],
              ['Абики / золото', num(f.pa), num(p.pa)]
            ]
          },
          {
            title: 'Топ-ап и товарка',
            rows: [
              ['Комбо', num(f.combo), num(p.combo)],
              ['Настройки', num(f.settings), num(p.settings)],
              ['Аксессуары', num(f.accessories), num(p.accessories)],
              ['Страховки', num(f.insurance), num(p.insurance)],
              ['Смартфоны', num(f.phones), num(p.phones)]
            ]
          },
          {
            title: 'Ростелеком',
            rows: [
              ['WINK', num(f.wink), num(p.wink)],
              ['Заявка ШПД', num(f.shpd), num(p.shpd)],
              ['Фокусное об-ние', num(f.focus), num(p.focus)]
            ]
          },
          {
            title: 'Кредиты',
            rows: [
              ['Кредит · заявка', num(f.credit_request), num(p.credit_request)],
              ['Кредит · выдан', num(f.credit_issued), num(p.credit_issued)]
            ]
          },
          {
            title: 'Прочее',
            rows: [
              ['Плоттер', num(f.plotter), num(p.plotter)],
              ['HB', num(f.hb), num(p.hb)]
            ]
          }
        ];

  const title = kind === 'micro' ? 'Промежуточный отчёт' : 'Итоговый отчёт';
  const sub =
    kind === 'micro' && opts?.hourLabel
      ? `${esc(st.name)} · ${esc(st.code)} · ${esc(date)} · ${esc(opts.hourLabel)}`
      : `${esc(st.name)} · ${esc(st.code)} · ${esc(date)}`;

  let y = 120;
  const parts: string[] = [];
  for (const g of groups) {
    parts.push(
      `<text x="40" y="${y}" fill="#2AABEE" font-size="13" font-family="Arial,sans-serif" font-weight="700">${esc(g.title)}</text>`
    );
    y += 22;
    for (const [label, fact, plan] of g.rows) {
      const pct = plan > 0 ? Math.round((fact / plan) * 100) : fact > 0 ? 100 : 0;
      const fill = Math.round((Math.min(100, pct) / 100) * 140);
      const color = pct >= 100 ? '#30D158' : pct >= 50 ? '#FF9F0A' : '#FF453A';
      parts.push(`
        <text x="40" y="${y}" fill="#E5E7EB" font-size="13" font-family="Arial,sans-serif">${esc(label)}</text>
        <text x="200" y="${y}" fill="#FFFFFF" font-size="13" font-family="Arial,sans-serif" font-weight="700">${fact}/${plan || '—'}</text>
        <text x="300" y="${y}" fill="#A1A1AA" font-size="11" font-family="Arial,sans-serif">${pct}%</text>
        <g transform="translate(340,${y - 8})">
          <rect width="140" height="8" rx="4" fill="#2A2A2E"/>
          <rect width="${fill}" height="8" rx="4" fill="${color}"/>
        </g>`);
      y += 24;
    }
    y += 10;
  }

  const staffText = staff.map(esc).join(' · ') || '—';
  const height = Math.max(kind === 'micro' ? 420 : 560, y + 70);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="540" height="${height}" viewBox="0 0 540 ${height}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#0A0A0B"/><stop offset="100%" stop-color="#14141A"/>
  </linearGradient></defs>
  <rect width="540" height="${height}" rx="24" fill="url(#bg)"/>
  <rect width="540" height="6" fill="#2AABEE"/>
  <text x="40" y="48" fill="#2AABEE" font-size="13" font-family="Arial,sans-serif" font-weight="700" letter-spacing="2">T2 SALES</text>
  <text x="40" y="78" fill="#FFFFFF" font-size="22" font-family="Arial,sans-serif" font-weight="800">${esc(title)}</text>
  <text x="40" y="100" fill="#A1A1AA" font-size="13" font-family="Arial,sans-serif">${sub}</text>
  ${parts.join('\n')}
  <text x="40" y="${y + 8}" fill="#6B7280" font-size="11" font-family="Arial,sans-serif">Смена: ${staffText}</text>
  <text x="40" y="${y + 28}" fill="#4B5563" font-size="10" font-family="Arial,sans-serif">T2 Sales · Europe/Moscow</text>
</svg>`;
}

/** SVG → PNG (Telegram photo). Нужен пакет @resvg/resvg-js */
export async function svgToPng(svg: string): Promise<Buffer> {
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1080 },
      font: { loadSystemFonts: false }
    });
    return Buffer.from(resvg.render().asPng());
  } catch (e: any) {
    console.error('svgToPng failed:', e?.message || e);
    throw new Error(
      'PNG conversion failed. Install: npm i @resvg/resvg-js — ' + (e?.message || e)
    );
  }
}

export async function buildDailyReportPng(
  storeId: string,
  date: string,
  opts?: { kind?: ReportKind; hourLabel?: string }
) {
  const svg = await buildDailyReportSvg(storeId, date, opts);
  const png = await svgToPng(svg);
  return { svg, png };
}
