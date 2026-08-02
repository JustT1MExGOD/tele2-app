/**
 * Генерация SVG-отчёта дня (без puppeteer).
 * Устойчив к отсутствующим колонкам / таблицам.
 */
import { query } from '../db/index.js';

function n(v: any) {
  return Number(v) || 0;
}
function esc(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function bar(pct: number, w = 140) {
  const p = Math.max(0, Math.min(100, pct));
  const fill = Math.round((p / 100) * w);
  const color = p >= 100 ? '#30D158' : p >= 50 ? '#FF9F0A' : '#FF453A';
  return `<rect x="0" y="0" width="${w}" height="8" rx="4" fill="#2A2A2E"/>
    <rect x="0" y="0" width="${fill}" height="8" rx="4" fill="${color}"/>`;
}

async function safeQuery(sql: string, params: any[]) {
  try {
    return await query(sql, params);
  } catch (e: any) {
    console.warn('report-image query fail:', e?.message || e);
    return { rows: [] as any[] };
  }
}

export async function buildDailyReportSvg(
  storeId: string,
  date: string,
  brand?: { name?: string; color?: string }
) {
  const brandName = brand?.name || 'T2 Sales';
  const accent = brand?.color || '#2AABEE';

  const store = await safeQuery(
    `SELECT id, name, code FROM stores WHERE id = $1`,
    [storeId]
  );
  const st = store.rows[0] || { name: storeId, code: '' };

  // Только базовые метрики — меньше шансов упасть на schema drift
  const sales = await safeQuery(
    `SELECT
        COALESCE(SUM(sim),0) AS sim,
        COALESCE(SUM(mnp),0) AS mnp,
        COALESCE(SUM(pa),0) AS pa,
        COALESCE(SUM(combo),0) AS combo,
        COALESCE(SUM(phones),0) AS phones,
        COALESCE(SUM(accessories),0) AS accessories,
        COALESCE(SUM(wink),0) AS wink,
        COALESCE(SUM(shpd),0) AS shpd
     FROM sales
     WHERE store_id = $1 AND sale_date::date = $2::date`,
    [storeId, date]
  );
  const f = sales.rows[0] || {};

  // План на дату, иначе шаблон plan_date IS NULL
  let plan = await safeQuery(
    `SELECT sim, mnp, pa, combo, phones, accessories, wink, shpd
     FROM store_plans
     WHERE store_id = $1 AND plan_date::date = $2::date
     LIMIT 1`,
    [storeId, date]
  );
  if (!plan.rows[0]) {
    plan = await safeQuery(
      `SELECT sim, mnp, pa, combo, phones, accessories, wink, shpd
       FROM store_plans
       WHERE store_id = $1 AND plan_date IS NULL
       LIMIT 1`,
      [storeId]
    );
  }
  const p = plan.rows[0] || {};

  const staff = await safeQuery(
    `SELECT e.full_name
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE sch.store_id = $1 AND sch.work_date::date = $2::date
     ORDER BY e.full_name`,
    [storeId, date]
  );

  const lines: { label: string; fact: number; plan: number }[] = [
    { label: 'SIM', fact: n(f.sim), plan: n(p.sim) },
    { label: 'MNP', fact: n(f.mnp), plan: n(p.mnp) },
    { label: 'ПА', fact: n(f.pa), plan: n(p.pa) },
    { label: 'Комбо', fact: n(f.combo), plan: n(p.combo) },
    { label: 'Телефоны', fact: n(f.phones), plan: n(p.phones) },
    { label: 'Аксы', fact: n(f.accessories), plan: n(p.accessories) },
    { label: 'Wink', fact: n(f.wink), plan: n(p.wink) },
    { label: 'ШПД', fact: n(f.shpd), plan: n(p.shpd) }
  ];

  let y = 120;
  const rowsSvg: string[] = [];
  for (const row of lines) {
    const pct =
      row.plan > 0 ? Math.round((row.fact / row.plan) * 100) : row.fact > 0 ? 100 : 0;
    rowsSvg.push(`
      <text x="40" y="${y}" fill="#E5E7EB" font-size="14" font-family="Arial,sans-serif">${esc(row.label)}</text>
      <text x="160" y="${y}" fill="#FFFFFF" font-size="14" font-family="Arial,sans-serif" font-weight="700">${row.fact}/${row.plan || '—'}</text>
      <text x="280" y="${y}" fill="#A1A1AA" font-size="12" font-family="Arial,sans-serif">${pct}%</text>
      <g transform="translate(330,${y - 8})">${bar(pct)}</g>
    `);
    y += 28;
  }

  const staffText =
    staff.rows.map((r: any) => esc(r.full_name)).join(' · ') || '—';
  const height = Math.max(420, y + 80);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="520" height="${height}" viewBox="0 0 520 ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0A0A0B"/>
      <stop offset="100%" stop-color="#14141A"/>
    </linearGradient>
  </defs>
  <rect width="520" height="${height}" rx="24" fill="url(#bg)"/>
  <rect x="0" y="0" width="520" height="6" fill="${esc(accent)}"/>
  <text x="40" y="48" fill="${esc(accent)}" font-size="13" font-family="Arial,sans-serif" font-weight="700" letter-spacing="2">${esc(brandName).toUpperCase()}</text>
  <text x="40" y="78" fill="#FFFFFF" font-size="22" font-family="Arial,sans-serif" font-weight="800">Итог дня</text>
  <text x="40" y="100" fill="#A1A1AA" font-size="13" font-family="Arial,sans-serif">${esc(st.name)} · ${esc(st.code || '')} · ${esc(date)}</text>
  ${rowsSvg.join('\n')}
  <text x="40" y="${y + 24}" fill="#6B7280" font-size="11" font-family="Arial,sans-serif">Смена: ${staffText}</text>
  <text x="40" y="${y + 48}" fill="#4B5563" font-size="10" font-family="Arial,sans-serif">source: t2-sales · Europe/Moscow</text>
</svg>`;

  try {
    await query(
      `INSERT INTO report_images (store_id, report_date, kind, svg)
       VALUES ($1, $2::date, 'daily', $3)`,
      [storeId, date, svg]
    );
  } catch (_) {
    /* optional table */
  }

  return svg;
}
