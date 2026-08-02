/**
 * SVG + PNG отчёт дня
 * Текст рисуется шрифтом DejaVu Sans (кириллица) — assets/fonts/
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { query } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

/** Ищем TTF рядом с dist/src и в assets */
function resolveFontFiles(): string[] {
  const candidates = [
    path.join(process.cwd(), 'assets/fonts'),
    path.join(process.cwd(), 'backend/assets/fonts'),
    path.join(__dirname, '../../assets/fonts'),
    path.join(__dirname, '../assets/fonts'),
    path.join(__dirname, '../../../assets/fonts')
  ];
  const files: string[] = [];
  for (const dir of candidates) {
    for (const name of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
      const fp = path.join(dir, name);
      if (fs.existsSync(fp)) files.push(fp);
    }
    if (files.length) break;
  }
  if (!files.length) {
    console.warn('⚠️ DejaVu fonts not found — текст на PNG может пропасть. Положи TTF в assets/fonts/');
  } else {
    console.log('Fonts for reports:', files.map((f) => path.basename(f)).join(', '));
  }
  return files;
}

const FONT_FILES = resolveFontFiles();
const FONT = 'DejaVu Sans';

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
  opts?: {
    kind?: ReportKind;
    hourLabel?: string;
    name?: string;
    color?: string;
    brand?: { name?: string; color?: string };
  }
) {
  const kind = opts?.kind || 'final';
  const brandName = opts?.brand?.name || opts?.name || 'T2 Sales';
  const accent = opts?.brand?.color || opts?.color || '#2AABEE';
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
      `<text x="40" y="${y}" fill="${esc(accent)}" font-size="14" font-family="${FONT}" font-weight="700">${esc(g.title)}</text>`
    );
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
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0A0A0B"/>
      <stop offset="100%" stop-color="#14141A"/>
    </linearGradient>
  </defs>
  <rect width="560" height="${height}" rx="24" fill="url(#bg)"/>
  <rect width="560" height="6" fill="${esc(accent)}"/>
  <text x="40" y="48" fill="${esc(accent)}" font-size="13" font-family="${FONT}" font-weight="700" letter-spacing="1.5">${esc(brandName).toUpperCase()}</text>
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
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: true,
      defaultFontFamily: FONT
    }
  });
  const rendered = resvg.render();
  return Buffer.from(rendered.asPng());
}

export async function buildDailyReportPng(
  storeId: string,
  date: string,
  opts?: {
    kind?: ReportKind;
    hourLabel?: string;
    name?: string;
    color?: string;
    brand?: { name?: string; color?: string };
  }
) {
  const svg = await buildDailyReportSvg(storeId, date, opts);
  const png = await svgToPng(svg);
  return { svg, png };
}
