/**
 * SVG/PNG отчёты — метрики из каталога
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { query } from '../db/index.js';
import { getMetricDefs, MICRO_KEYS, groupForMetric } from './metrics-catalog.js';
import { getStoreHourWeights } from './insights.js';
import { renderSvgToPng } from './svg-render-pool.js';

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

function addDays(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Кадр «план» (сегодня) или «фокус завтра» — та же карточка, без факта:
 * список целей по метрикам + кто в графике + (для завтра) подсказка по
 * пиковому часу точки из store_hour_profile.
 */
async function buildPlanFrameSvg(
  storeId: string,
  date: string,
  opts: { title: string; brandName: string; accent: string; tip?: string }
) {
  const { st, p, staff, defs } = await loadFactPlanStaff(storeId, date);

  const rows = defs
    .map((d) => [d.label, num(p[d.id])] as [string, number])
    .filter(([, plan]) => plan > 0);

  let y = 120;
  const parts: string[] = [`<text x="40" y="${y}" fill="${esc(opts.accent)}" font-size="14" font-family="${FONT}" font-weight="700">Цели на день</text>`];
  y += 24;
  for (const [label, plan] of rows) {
    parts.push(`
      <text x="40" y="${y}" fill="#F3F4F6" font-size="14" font-family="${FONT}">${esc(label)}</text>
      <text x="480" y="${y}" fill="#FFFFFF" font-size="14" font-family="${FONT}" font-weight="700" text-anchor="end">${plan}</text>`);
    y += 26;
  }
  y += 12;

  const staffText = staff.map(esc).join(' · ') || '—';
  let footY = y + 10;
  parts.push(`<text x="40" y="${footY}" fill="#9CA3AF" font-size="12" font-family="${FONT}">В графике: ${staffText}</text>`);
  footY += 22;
  if (opts.tip) {
    parts.push(`<text x="40" y="${footY}" fill="${esc(opts.accent)}" font-size="12" font-family="${FONT}">💡 ${esc(opts.tip)}</text>`);
    footY += 22;
  }

  const height = Math.max(440, footY + 40);
  const sub = `${esc(st.name)} · ${esc(st.code)} · ${esc(date)}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="560" height="${height}" viewBox="0 0 560 ${height}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#0A0A0B"/><stop offset="100%" stop-color="#14141A"/>
  </linearGradient></defs>
  <rect width="560" height="${height}" rx="24" fill="url(#bg)"/>
  <rect width="560" height="6" fill="${esc(opts.accent)}"/>
  <text x="40" y="48" fill="${esc(opts.accent)}" font-size="13" font-family="${FONT}" font-weight="700">${esc(opts.brandName).toUpperCase()}</text>
  <text x="40" y="78" fill="#FFFFFF" font-size="24" font-family="${FONT}" font-weight="700">${esc(opts.title)}</text>
  <text x="40" y="102" fill="#A1A1AA" font-size="13" font-family="${FONT}">${sub}</text>
  ${parts.join('\n')}
  <text x="40" y="${height - 24}" fill="#6B7280" font-size="11" font-family="${FONT}">T2 Sales · Europe/Moscow</text>
</svg>`;
}

async function peakHourTip(storeId: string, date: string): Promise<string | undefined> {
  try {
    const dow = new Date(date + 'T12:00:00').getDay();
    const weights = await getStoreHourWeights(storeId, dow);
    const peak = weights.slice().sort((a, b) => b.weight - a.weight)[0];
    if (!peak) return undefined;
    return `Обычно пик около ${peak.hour}:00 — держите там сильного продавца`;
  } catch {
    return undefined;
  }
}

/** Story дня: 3 кадра — план → факт → фокус на завтра, тем же рендерером */
export async function buildStoryReportSvgs(
  storeId: string,
  date: string,
  opts?: { name?: string; color?: string; brand?: { name?: string; color?: string } }
) {
  const brandName = opts?.brand?.name || opts?.name || 'T2 Sales';
  const accent = opts?.brand?.color || opts?.color || '#2AABEE';
  const tomorrow = addDays(date, 1);

  const [plan, fact, tomorrowTip] = await Promise.all([
    buildPlanFrameSvg(storeId, date, { title: 'План дня', brandName, accent }),
    buildDailyReportSvg(storeId, date, { kind: 'final', name: brandName, color: accent }),
    peakHourTip(storeId, tomorrow)
  ]);
  const tomorrowFrame = await buildPlanFrameSvg(storeId, tomorrow, {
    title: 'Фокус на завтра',
    brandName,
    accent,
    tip: tomorrowTip
  });

  return { plan, fact, tomorrow: tomorrowFrame };
}

export async function buildStoryReportPngs(
  storeId: string,
  date: string,
  opts?: { name?: string; color?: string; brand?: { name?: string; color?: string } }
) {
  const svgs = await buildStoryReportSvgs(storeId, date, opts);
  const [plan, fact, tomorrow] = await Promise.all([
    svgToPng(svgs.plan),
    svgToPng(svgs.fact),
    svgToPng(svgs.tomorrow)
  ]);
  return { svgs, plan, fact, tomorrow };
}

/** Карточка-анонс версии в чат — тот же resvg-пайплайн, что и у отчётов. */
export async function buildReleaseCardSvg(
  entry: { version: string; title: string; bullets: string[] },
  opts?: { name?: string; color?: string; brand?: { name?: string; color?: string } }
) {
  const brandName = opts?.brand?.name || opts?.name || 'T2 Sales';
  const accent = opts?.brand?.color || opts?.color || '#2AABEE';

  // SVG не переносит текст сам — режем длинные строки вручную, иначе они
  // вылезают за карточку (560px). Раньше это применялось только к буллетам —
  // заголовок оставался одной строкой без переноса и обрезался по краю
  // карточки на длинных названиях версий.
  function wrapText(text: string, maxCharsPerLine: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > maxCharsPerLine && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  const TITLE_LINE_HEIGHT = 32;
  const titleLines = wrapText(entry.title, 26);
  const titleY = 84;
  const titleBlock = titleLines
    .map((line, i) => `<text x="40" y="${titleY + i * TITLE_LINE_HEIGHT}" fill="#FFFFFF" font-size="26" font-family="${FONT}" font-weight="700">${esc(line)}</text>`)
    .join('\n');
  const extraTitleHeight = (titleLines.length - 1) * TITLE_LINE_HEIGHT;
  const versionY = 112 + extraTitleHeight;

  let y = 150 + extraTitleHeight;
  const parts: string[] = [];
  for (const b of entry.bullets) {
    const lines = wrapText(b, 46);
    lines.forEach((line, i) => {
      const x = i === 0 ? 40 : 58;
      const text = i === 0 ? `•  ${esc(line)}` : esc(line);
      parts.push(`<text x="${x}" y="${y}" fill="#F3F4F6" font-size="16" font-family="${FONT}">${text}</text>`);
      y += 26;
    });
    y += 6;
  }
  const height = Math.max(360, y + 60);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="560" height="${height}" viewBox="0 0 560 ${height}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#0A0A0B"/><stop offset="100%" stop-color="#14141A"/>
  </linearGradient></defs>
  <rect width="560" height="${height}" rx="24" fill="url(#bg)"/>
  <rect width="560" height="6" fill="${esc(accent)}"/>
  <text x="40" y="48" fill="${esc(accent)}" font-size="13" font-family="${FONT}" font-weight="700">${esc(brandName).toUpperCase()} · ОБНОВЛЕНИЕ</text>
  ${titleBlock}
  <text x="40" y="${versionY}" fill="#A1A1AA" font-size="14" font-family="${FONT}">версия ${esc(entry.version)}</text>
  ${parts.join('\n')}
  <text x="40" y="${height - 24}" fill="#6B7280" font-size="11" font-family="${FONT}">T2 Sales · Europe/Moscow</text>
</svg>`;
}

export async function buildReleaseCardPng(
  entry: { version: string; title: string; bullets: string[] },
  opts?: { name?: string; color?: string; brand?: { name?: string; color?: string } }
) {
  const svg = await buildReleaseCardSvg(entry, opts);
  return { svg, png: await svgToPng(svg) };
}

export async function svgToPng(svg: string): Promise<Buffer> {
  return renderSvgToPng({ svg, fitWidth: 1120, fontFiles: FONT_FILES, defaultFontFamily: FONT });
}

export async function buildDailyReportPng(
  storeId: string,
  date: string,
  opts?: { kind?: ReportKind; hourLabel?: string; name?: string; color?: string; brand?: { name?: string; color?: string } }
) {
  const svg = await buildDailyReportSvg(storeId, date, opts);
  return { svg, png: await svgToPng(svg) };
}
