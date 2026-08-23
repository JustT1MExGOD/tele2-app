/**
 * SVG/PNG отчёты — метрики из каталога
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as repo from '../../data/repositories/report-image.js';
import { getMetricDefs, MICRO_KEYS, groupForMetric } from '../shared/metrics-catalog.js';
import { getStoreHourWeights } from '../analytics/insights.js';
import { renderSvgToPng } from './svg-pool.js';

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
  const storeRow = await repo.findStoreBasic(storeId);
  const st = storeRow || { name: storeId, code: '' };

  const defs = await getMetricDefs();
  const ids = defs.map((d) => d.id).filter((id) => /^[a-z][a-z0-9_]{0,29}$/.test(id));
  const sumParts = ids.map((id) => `COALESCE(SUM(${id}),0) as ${id}`).join(', ');

  let f: any = {};
  try {
    f = await repo.sumDayFactColumns(storeId, date, sumParts);
  } catch {
    f = {};
  }

  let p: any = {};
  try {
    p = await repo.findDayOrTemplatePlan(storeId, date);
  } catch { p = {}; }

  const staff = await repo.listStaffNames(storeId, date);

  return { st, f, p, staff, defs };
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

const RELEASE_FONT = 'Google Sans';
function resolveGoogleSansFontFiles(): string[] {
  const candidates = [
    path.join(process.cwd(), 'assets/fonts'),
    path.join(__dirname, '../../assets/fonts'),
    path.join(__dirname, '../assets/fonts')
  ];
  const files: string[] = [];
  for (const dir of candidates) {
    for (const name of ['GoogleSans-Regular.ttf', 'GoogleSans-SemiBold.ttf', 'GoogleSans-Bold.ttf']) {
      const fp = path.join(dir, name);
      if (fs.existsSync(fp)) files.push(fp);
    }
    if (files.length) break;
  }
  return files;
}
const RELEASE_FONT_FILES = resolveGoogleSansFontFiles();

const RU_MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function ruDateNow(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  return `${now.getDate()} ${RU_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

// SVG не переносит текст сам — режем длинные строки вручную по количеству
// символов, иначе вылезают за карточку (560px). Грубая оценка ширины
// символа, не honest text-metrics — но с большим запасом по краям карточки
// (max-width строки заметно уже 560px), на кириллице Google Sans этого
// достаточно, реальных переполнений на всех версиях в CHANGELOG не было.
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

/**
 * Карточка-анонс версии в чат — тот же resvg-пайплайн, что и у отчётов, но
 * свой шрифт (Google Sans, не общий DejaVu Sans отчётов) и свой макет:
 * цветной градиентный блок-заголовок с крупным номером версии + тёмное тело
 * с буллетами — тот же язык, что уже используют промо-карточки T2 Retail
 * (жирный цветной блок сверху, крупный номер/факт, скруглённая карточка),
 * адаптированный под наш акцент и без фото людей — это генерируемая
 * SVG→PNG картинка, не дизайн-макет с фотосессией.
 */
export async function buildReleaseCardSvg(
  entry: { version: string; title: string; bullets: string[] },
  opts?: { name?: string; color?: string; brand?: { name?: string; color?: string; colorDeep?: string } }
) {
  const brandName = (opts?.brand?.name || opts?.name || 'T2 Sales').toUpperCase();
  const accent = opts?.brand?.color || opts?.color || '#2AABEE';
  const accentDeep = opts?.brand?.colorDeep || '#1A8FD1';

  const W = 560;
  const PAD = 32;
  const CONTENT_W = W - PAD * 2;

  // "19.9.0" -> крупно "19.9", мельче ".0" (тот же приём, что в одобренном
  // макете — последняя точка отделяет "патч", а не просто разбивка пополам).
  const dotIdx = entry.version.lastIndexOf('.');
  const versionMain = dotIdx === -1 ? entry.version : entry.version.slice(0, dotIdx);
  const versionTail = dotIdx === -1 ? '' : entry.version.slice(dotIdx);

  // --- Заголовок: сначала переносим строки и меряем высоту блока, сама
  // разметка с абсолютными Y строится ниже, когда уже известно, откуда
  // блок начинается по вертикали (зависит только от HEAD_H, известного
  // заранее — а вот буллеты после заголовка зависят от числа его строк). ---
  const TITLE_LINE_H = 28;
  const titleLines = wrapText(entry.title, 34);
  const titleBlockH = (titleLines.length - 1) * TITLE_LINE_H;

  // --- Буллеты: та же логика — сначала разбиваем на строки и меряем
  // суммарную высоту, координаты каждой строки посчитаем один раз ниже. ---
  const BULLET_LINE_H = 23;
  const BULLET_GAP = 8;
  const bulletLineGroups = entry.bullets.map((b) => wrapText(b, 52));
  let bulletsH = 0;
  for (const lines of bulletLineGroups) bulletsH += lines.length * BULLET_LINE_H + BULLET_GAP;

  // --- Геометрия по вертикали ---
  const HEAD_H = 168;
  const BODY_TOP = HEAD_H + 34;
  const titleY0 = BODY_TOP + 20; // baseline первой строки заголовка
  const dividerY = titleY0 + titleBlockH + 30;
  const bulletsY0 = dividerY + 26;
  const footY = bulletsY0 + bulletsH + 8;
  const H = footY + 44;

  const versionBaselineY = HEAD_H - 34;

  const titleBlock = titleLines
    .map((line, i) => `<text x="${PAD}" y="${titleY0 + i * TITLE_LINE_H}" fill="#FFFFFF" font-size="20" font-family="${RELEASE_FONT}" font-weight="600">${esc(line)}</text>`)
    .join('\n');

  const bulletParts: string[] = [];
  let by = bulletsY0;
  for (const lines of bulletLineGroups) {
    lines.forEach((line, i) => {
      if (i === 0) bulletParts.push(`<circle cx="${PAD + 3}" cy="${by - 5}" r="3" fill="${esc(accent)}"/>`);
      bulletParts.push(`<text x="${PAD + 15}" y="${by}" fill="#C9CDD8" font-size="14.5" font-family="${RELEASE_FONT}">${esc(line)}</text>`);
      by += BULLET_LINE_H;
    });
    by += BULLET_GAP;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="headGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${esc(accent)}"/>
      <stop offset="100%" stop-color="${esc(accentDeep)}"/>
    </linearGradient>
    <clipPath id="cardClip"><rect width="${W}" height="${H}" rx="28"/></clipPath>
    <filter id="soften" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="20"/>
    </filter>
  </defs>
  <g clip-path="url(#cardClip)">
    <rect width="${W}" height="${H}" fill="#0B0E14"/>
    <rect width="${W}" height="${HEAD_H}" fill="url(#headGrad)"/>
    <circle cx="${W}" cy="0" r="130" fill="#FFFFFF" opacity="0.14" filter="url(#soften)"/>
    <circle cx="${W - 60}" cy="${HEAD_H + 30}" r="90" fill="#FFFFFF" opacity="0.08" filter="url(#soften)"/>

    <rect x="${PAD}" y="28" width="30" height="30" rx="9" fill="#FFFFFF" fill-opacity="0.22"/>
    <svg x="${PAD + 6}" y="34" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>
    </svg>
    <text x="${PAD + 40}" y="47" fill="#FFFFFF" fill-opacity="0.92" font-size="12" font-family="${RELEASE_FONT}" font-weight="700" letter-spacing="1">${esc(brandName)} · ОБНОВЛЕНИЕ</text>

    <text x="${PAD}" y="${versionBaselineY}" fill="#FFFFFF" font-size="52" font-family="${RELEASE_FONT}" font-weight="700" letter-spacing="-0.01em">${esc(versionMain)}<tspan font-size="22" font-weight="600" fill-opacity="0.75" dx="2">${esc(versionTail)}</tspan></text>

    ${titleBlock}

    <rect x="${PAD}" y="${dividerY}" width="${CONTENT_W}" height="1" fill="#FFFFFF" fill-opacity="0.09"/>

    ${bulletParts.join('\n')}

    <rect x="${PAD}" y="${footY}" width="${CONTENT_W}" height="1" fill="#FFFFFF" fill-opacity="0.07"/>
    <text x="${PAD}" y="${footY + 26}" fill="#FFFFFF" fill-opacity="0.5" font-size="12" font-family="${RELEASE_FONT}" font-weight="700" letter-spacing="0.5">${esc(brandName)}</text>
    <text x="${W - PAD}" y="${footY + 26}" fill="#FFFFFF" fill-opacity="0.35" font-size="12" font-family="${RELEASE_FONT}" text-anchor="end">${esc(ruDateNow())}</text>
  </g>
</svg>`;
}

export async function buildReleaseCardPng(
  entry: { version: string; title: string; bullets: string[] },
  opts?: { name?: string; color?: string; brand?: { name?: string; color?: string; colorDeep?: string } }
) {
  const svg = await buildReleaseCardSvg(entry, opts);
  const png = await renderSvgToPng({ svg, fitWidth: 1120, fontFiles: RELEASE_FONT_FILES, defaultFontFamily: RELEASE_FONT });
  return { svg, png };
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
