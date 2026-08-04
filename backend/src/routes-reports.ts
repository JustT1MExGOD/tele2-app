/**
 * Отчёты по точке: SVG-картинка (тот же набор метрик, что в чате бота)
 * + ручная отправка микро/итогового отчёта в чат.
 * Вынесено из index.ts при разбиении монолита на модули.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { todayMoscow } from './utils/date.js';
import { requireActive, requireManager } from './middleware-auth.js';
import { getSalesSumColumns, metricLabelMap } from './services/metrics-catalog.js';
import { buildDailyReportSvg, buildStoryReportSvgs } from './services/report-image.js';

function escSvg(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadFactPlanStaff(storeId: string, date: string) {
  const storeRes = await query(`SELECT id, name, code FROM stores WHERE id = $1`, [storeId]).catch(
    () => ({ rows: [] as any[] })
  );
  const st = storeRes.rows[0] || { name: storeId, code: '' };

  // Динамический список — чтобы кастомные метрики не пропадали из отчёта
  // (раньше был жёсткий список из 15 полей, всё остальное молча терялось).
  const salesCols = await getSalesSumColumns();
  const salesRes = await query(
    `SELECT ${salesCols.map((c) => `COALESCE(SUM(${c}),0) ${c}`).join(', ')}
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

  return { st, f, p, staff: staffRes.rows.map((r: any) => r.full_name) };
}

/** SVG в той же структуре метрик, что итоговый отчёт в чат */
async function buildDayReportSvgInline(storeId: string, date: string) {
  const { st, f, p, staff } = await loadFactPlanStaff(storeId, date);
  const num = (v: any) => Number(v) || 0;

  const groups: { title: string; rows: [string, number, number][] }[] = [
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

  // Любые метрики (кастомные или добавленные вручную колонки), которых нет
  // в группах выше, — чтобы данные не "терялись" из отчёта молча.
  const knownIds = new Set([
    'sim', 'mnp', 'pa', 'combo', 'settings', 'accessories', 'insurance',
    'phones', 'wink', 'shpd', 'focus', 'credit_request', 'credit_issued',
    'plotter', 'hb'
  ]);
  const extraIds = Object.keys(f).filter((k) => !knownIds.has(k));
  if (extraIds.length) {
    const labels = await metricLabelMap();
    groups.push({
      title: 'Доп. метрики',
      rows: extraIds.map((k) => [labels[k] || k, num(f[k]), num(p[k])] as [string, number, number])
    });
  }

  let y = 120;
  const parts: string[] = [];
  for (const g of groups) {
    parts.push(
      `<text x="40" y="${y}" fill="#2AABEE" font-size="13" font-family="Arial,sans-serif" font-weight="700">${escSvg(g.title)}</text>`
    );
    y += 22;
    for (const [label, fact, plan] of g.rows) {
      const pct = plan > 0 ? Math.round((fact / plan) * 100) : fact > 0 ? 100 : 0;
      const fill = Math.round((Math.min(100, pct) / 100) * 140);
      const color = pct >= 100 ? '#30D158' : pct >= 50 ? '#FF9F0A' : '#FF453A';
      parts.push(`
        <text x="40" y="${y}" fill="#E5E7EB" font-size="13" font-family="Arial,sans-serif">${escSvg(label)}</text>
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

  const staffText = staff.map(escSvg).join(' · ') || '—';
  const height = Math.max(520, y + 70);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="540" height="${height}" viewBox="0 0 540 ${height}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#0A0A0B"/><stop offset="100%" stop-color="#14141A"/>
  </linearGradient></defs>
  <rect width="540" height="${height}" rx="24" fill="url(#bg)"/>
  <rect width="540" height="6" fill="#2AABEE"/>
  <text x="40" y="48" fill="#2AABEE" font-size="13" font-family="Arial,sans-serif" font-weight="700" letter-spacing="2">T2 SALES</text>
  <text x="40" y="78" fill="#FFFFFF" font-size="22" font-family="Arial,sans-serif" font-weight="800">Итоговый отчёт</text>
  <text x="40" y="100" fill="#A1A1AA" font-size="13" font-family="Arial,sans-serif">${escSvg(st.name)} · ${escSvg(st.code)} · ${escSvg(date)}</text>
  ${parts.join('\n')}
  <text x="40" y="${y + 8}" fill="#6B7280" font-size="11" font-family="Arial,sans-serif">Смена: ${staffText}</text>
  <text x="40" y="${y + 28}" fill="#4B5563" font-size="10" font-family="Arial,sans-serif">тот же набор метрик, что в чате · Europe/Moscow</text>
</svg>`;
}

export async function registerReportsRoutes(app: FastifyInstance) {
  app.get('/reports/day/:storeId', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const storeId = String((request.params as any).storeId || '');
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    const kind = ((request.query as any)?.kind === 'micro' ? 'micro' : 'final') as 'micro' | 'final';
    if (!storeId) return reply.code(400).send({ error: 'store_id_required' });
    try {
      // 'final' в проде уходит в чат как story из 3 кадров (14.7.0) — превью
      // должно показывать то же самое, а не одиночную старую картинку.
      if (kind === 'final') {
        try {
          const svgs = await buildStoryReportSvgs(storeId, date);
          return { ok: true, store_id: storeId, date, kind: 'story', content_type: 'image/svg+xml', svgs };
        } catch {
          const svg = await buildDayReportSvgInline(storeId, date);
          return { ok: true, store_id: storeId, date, kind, content_type: 'image/svg+xml', svg };
        }
      }
      let svg: string;
      try {
        svg = await buildDailyReportSvg(storeId, date, { kind });
      } catch {
        svg = await buildDayReportSvgInline(storeId, date);
      }
      return { ok: true, store_id: storeId, date, kind, content_type: 'image/svg+xml', svg };
    } catch (e: any) {
      request.log.error(e);
      return reply.code(500).send({ error: 'report_failed', message: e?.message || String(e) });
    }
  });

  app.get('/reports/svg', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const q = (request.query || {}) as any;
    const storeId = String(q.store_id || '');
    const date = String(q.date || todayMoscow()).slice(0, 10);
    if (!storeId) return reply.code(400).send({ error: 'store_id_required' });
    try {
      const svg = await buildDayReportSvgInline(storeId, date);
      reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
      return reply.send(svg);
    } catch (e: any) {
      return reply.code(500).send({ error: 'report_failed', message: e?.message || String(e) });
    }
  });

  /** Ручная отправка микро/итога в REPORT_CHAT_ID (для теста) */
  app.post('/reports/send-micro', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    try {
      const { sendMicroReports } = await import('./cron/reports.js');
      const body = (request.body || {}) as any;
      const date = String(body.date || todayMoscow()).slice(0, 10);
      const hour = Number(body.hour) || new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' })
      ).getHours();
      const result = await sendMicroReports(date, hour);
      return result;
    } catch (e: any) {
      return reply.code(500).send({ error: 'send_failed', message: e?.message || String(e) });
    }
  });

  app.post('/reports/send-final', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    try {
      const { sendFinalReports } = await import('./cron/reports.js');
      const body = (request.body || {}) as any;
      const date = String(body.date || todayMoscow()).slice(0, 10);
      const result = await sendFinalReports(date);
      return result;
    } catch (e: any) {
      return reply.code(500).send({ error: 'send_failed', message: e?.message || String(e) });
    }
  });
}
