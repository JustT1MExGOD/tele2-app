/**
 * SVG/PNG отчёты — метрики из каталога
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { query } from '../db/index.js';
import { getMetricDefs, MICRO_KEYS, groupForMetric } from './metrics-catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FONT = 'DejaVu Sans';

function esc(s: any) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function num(v: any) { return Number(v) || 0; }

function resolveFontFiles(): string[] {
  const candidates = [
    path.join(process.cwd(), 'assets/fonts'),
    path.join(__dirname, '../../assets/fonts'),
    path.join(__dirname, '../assets/fonts')
  ];
  const files: string[] = [];
  for (const dir of candidates) {
    for (const name of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
      const fp = path.join(dir, name);
      if (fs.existsSync(fp)) files.push(fp);
    }
    if (files.length) break;
  }
  return files;
}
const FONT_FILES = resolveFontFiles();

export async function loadFactPlanStaff(storeId: string, date: string) {
  const storeRes = await query(`SELECT id, name, code FROM stores WHERE id = $1`, [storeId]).catch(() => ({ rows: [] as any[] }));
  const st = storeRes.rows[0] || { name: storeId, code: '' };

  const defs = await getMetricDefs();
  const ids = defs.map((d) => d.id).filter((id) => /^[a-z][a-z0-9_]{0,29}$/.test(id));
  const sumParts = ids.map((id) => `COALESCE(SUM(${id}),0) as ${id}`).join(', ');

  let f: any = {};
  try {
    const salesRes = await query(
      `SELECT ${sumParts} FROM sales WHERE store_id = $1 AND sale_date::date = $2::date`,
      [storeId, date]
    );
    f = salesRes.rows[0] || {};
  } catch {
    f = {};
  }

  let p: any = {};
  try {
    let planRes = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date::date = $2::date LIMIT 1`,
      [storeId, date]
    );
    if (!planRes.rows[0]) {
      planRes = await query(
        `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL LIMIT 1`,
        [storeId]
      );
    }
    p = planRes.rows[0] || {};
  } catch { p = {}; }

  const staffRes = await query(
    `SELECT e.full_name FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE sch.store_id = $1 AND sch.work_date::date = $2::date AND COALESCE(sch.hours,0)>0
     ORDER BY e.full_name`,
    [storeId, date]
  ).catch(() => ({ rows: [] as any[] }));

  return { st, f, p, staff: staffRes.rows.map((r: any) => r.full_name as string), defs };
}

export type ReportKind = 'micro' | 'final';

export async function buildDailyReportSvg(
  storeId: string,
  date: string,
  opts?: { kind?: ReportKind; hourLabel?: string; name?: string; color?: string; brand?: { name?: string; color?: string } }
) {
  const kind = opts?.kind || 'final';
  const brandName = opts?.brand?.name || opts?.name || 'T2 Sales';
  const accent = opts?.brand?.color || opts?.color || '#2AABEE';
  const { st, f, p, staff, defs } = await loadFactPlanStaff(storeId, date);

  const groups: { title: string; rows: [string, number, number][] }[] = [];

  if (kind === 'micro') {
    const rows: [string, number, number][] = [];
    const seen = new Set<string>();
    for (const id of MICRO_KEYS) {
      const def = defs.find((d) => d.id === id);
      if (!def) continue;
      rows.push([def.label, num(f[id]), num(p[id])]);
      seen.add(id);
    }
    for (const def of defs) {
      if (seen.has(def.id)) continue;
      if (num(f[def.id]) || num(p[def.id])) rows.push([def.label, num(f[def.id]), num(p[def.id])]);
    }
    groups.push({ title: 'Факт / план', rows });
  } else {
    const bucket: Record<string, [string, number, number][]> = {
      gi: [], top: [], rt: [], credit: [], other: []
    };
    const titles: Record<string, string> = {
      gi: 'Блок GI', top: 'Топ-ап и товарка', rt: 'Ростелеком', credit: 'Кредиты', other: 'Прочее'
    };
    for (const def of defs) {
      const g = groupForMetric(def.id, def.label);
      bucket[g].push([def.label, num(f[def.id]), num(p[def.id])]);
    }
    for (const key of ['gi', 'top', 'rt', 'credit', 'other']) {
      if (bucket[key].length) groups.push({ title: titles[key], rows: bucket[key] });
    }
  }

  const title = kind === 'micro' ? 'Промежуточный отчёт' : 'Итоговый отчёт';
  const sub = kind === 'micro' && opts?.hourLabel
    ? `${esc(st.name)} · ${esc(st.code)} · ${esc(date)} · ${esc(opts.hourLabel)}`
    : `${esc(st.name)} · ${esc(st.code)} · ${esc(date)}`;

  let y = 120;
  const parts: string[] = [];
  for (const g of groups) {
    parts.push(`<text x="40" y="${y}" fill="${esc(accent)}" font-size="14" font-family="${FONT}" font-weight="700">${esc(g.title)}</text>`);
    y += 24;
    for (const [label, fact, plan] of g.rows) {
      const pct = plan > 0 ? Math.round((fact / plan) * 100) : fact > 0 ? 100 : 0;
      const fill = Math.round((Math.min(100, Math.max(0, pct)) / 100) * 140);
      const color = pct >= 100 ? '#30D158' : pct >= 50 ? '#FF9F0A' : '#FF453A';
      parts.push(`
        <text x="40" y="${y}" fill="#F3F4F6" font-size="14" font-family="${FONT}">${esc(label)}</text>
        <text x="210" y="${y}" fill="#FFFFFF" font-size="14" font-family="${FONT}" font-weight="700">${fact}/${plan || '—'}</text>
        <text x="310" y="${y}" fill="#A1A1AA" font-size="12" font-family="${FONT}">${pct}%</text>
        <g transform="translate(360,${y - 9})">
          <rect width="140" height="10" rx="5" fill="#2A2A2E"/>
          <rect width="${fill}" height="10" rx="5" fill="${color}"/>
        </g>`);
      y += 26;
    }
    y += 12;
  }
  const staffText = staff.map(esc).join(' · ') || '—';
  const height = Math.max(kind === 'micro' ? 440 : 620, y + 80);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="560" height="${height}" viewBox="0 0 560 ${height}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#0A0A0B"/><stop offset="100%" stop-color="#14141A"/>
  </linearGradient></defs>
  <rect width="560" height="${height}" rx="24" fill="url(#bg)"/>
  <rect width="560" height="6" fill="${esc(accent)}"/>
  <text x="40" y="48" fill="${esc(accent)}" font-size="13" font-family="${FONT}" font-weight="700">${esc(brandName).toUpperCase()}</text>
  <text x="40" y="78" fill="#FFFFFF" font-size="24" font-family="${FONT}" font-weight="700">${esc(title)}</text>
  <text x="40" y="102" fill="#A1A1AA" font-size="13" font-family="${FONT}">${sub}</text>
  ${parts.join('\n')}
  <text x="40" y="${y + 10}" fill="#9CA3AF" font-size="12" font-family="${FONT}">Смена: ${staffText}</text>
  <text x="40" y="${y + 32}" fill="#6B7280" font-size="11" font-family="${FONT}">T2 Sales · Europe/Moscow</text>
</svg>`;
}

export async function svgToPng(svg: string): Promise<Buffer> {
  const { Resvg } = await import('@resvg/resvg-js');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1120 },
    font: { fontFiles: FONT_FILES, loadSystemFonts: true, defaultFontFamily: FONT }
  });
  return Buffer.from(resvg.render().asPng());
}

export async function buildDailyReportPng(
  storeId: string,
  date: string,
  opts?: { kind?: ReportKind; hourLabel?: string; name?: string; color?: string; brand?: { name?: string; color?: string } }
) {
  const svg = await buildDailyReportSvg(storeId, date, opts);
  return { svg, png: await svgToPng(svg) };
}
