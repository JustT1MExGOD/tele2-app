/**
 * Cron: микро/итог → картинка в REPORT_CHAT_ID
 */
import { query } from '../db/index.js';
import { todayMoscow } from '../utils/date.js';
import { notifyChat, notifyChatPhoto, notifyUser } from '../bot/index.js';
import { shiftReminder, microReport, finalReport, microLines, finalLines } from '../bot/messages.js';
import { buildDailyReportPng, buildDailyReportSvg } from '../services/report-image.js';

const FACT_SQL = `
  SELECT
    COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp, COALESCE(SUM(pa),0) pa,
    COALESCE(SUM(combo),0) combo, COALESCE(SUM(phones),0) phones,
    COALESCE(SUM(accessories),0) accessories, COALESCE(SUM(settings),0) settings,
    COALESCE(SUM(insurance),0) insurance, COALESCE(SUM(wink),0) wink,
    COALESCE(SUM(shpd),0) shpd, COALESCE(SUM(focus),0) focus,
    COALESCE(SUM(credit_request),0) credit_request,
    COALESCE(SUM(credit_issued),0) credit_issued,
    COALESCE(SUM(plotter),0) plotter, COALESCE(SUM(hb),0) hb
  FROM sales
  WHERE sale_date::date = $1::date AND store_id = $2
`;

async function loadStorePlans(date: string) {
  const stores = await query(`SELECT id, name, code FROM stores ORDER BY name`);
  const out = [];
  for (const st of stores.rows) {
    let planRes = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date::date = $2::date LIMIT 1`,
      [st.id, date]
    ).catch(() => ({ rows: [] as any[] }));
    if (!planRes.rows[0]) {
      planRes = await query(
        `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL LIMIT 1`,
        [st.id]
      ).catch(() => ({ rows: [] as any[] }));
    }
    out.push({
      store_id: st.id,
      name: st.name,
      code: st.code,
      plan: planRes.rows[0] || {}
    });
  }
  return out;
}

async function sendStoreReportImage(
  st: { store_id: string; name: string; code: string; plan: any },
  date: string,
  kind: 'micro' | 'final',
  hour?: number
) {
  const hourLabel =
    kind === 'micro' && hour != null ? `${String(hour).padStart(2, '0')}:00` : undefined;
  const caption =
    kind === 'micro'
      ? `📊 ${st.name} · ${date}${hourLabel ? ' · ' + hourLabel : ''}`
      : `🏁 ${st.name} · ${date}`;

  try {
    const { png } = await buildDailyReportPng(st.store_id, date, {
      kind,
      hourLabel
    });
    const r = await notifyChatPhoto(png, {
      caption,
      filename: `${kind}_${st.store_id}_${date}.png`
    });
    if (r.ok) return r;
    throw new Error(r.error || 'photo_failed');
  } catch (e: any) {
    console.warn('PNG send failed, try SVG document:', e?.message || e);
    try {
      const svg = await buildDailyReportSvg(st.store_id, date, { kind, hourLabel });
      return await notifyChatPhoto(svg, {
        caption,
        filename: `${kind}_${st.store_id}_${date}.svg`,
        asDocument: true
      });
    } catch (e2: any) {
      // last resort: text
      console.warn('SVG also failed, text fallback:', e2?.message || e2);
      const staff = await query(
        `SELECT e.full_name FROM schedules sch
         JOIN employees e ON e.id = sch.employee_id
         WHERE sch.work_date::date = $1::date AND sch.store_id = $2 AND COALESCE(sch.hours,0)>0`,
        [date, st.store_id]
      );
      const fact = await query(FACT_SQL, [date, st.store_id]).catch(() => ({ rows: [{}] }));
      const f = fact.rows[0] || {};
      const text =
        kind === 'micro'
          ? microReport({
              storeName: st.name,
              storeCode: st.code || st.store_id,
              date: `${date}${hourLabel ? ' · ' + hourLabel : ''}`,
              staff: staff.rows.map((x: any) => x.full_name),
              lines: microLines(f, st.plan)
            })
          : finalReport({
              storeName: st.name,
              storeCode: st.code || st.store_id,
              date,
              staff: staff.rows.map((x: any) => x.full_name),
              lines: finalLines(f, st.plan)
            });
      await notifyChat(text);
      return { ok: true, type: 'text_fallback' };
    }
  }
}

export function startReportCron() {
  console.log('📅 Cron T2: микро/итог → PNG в чат (10–20 / 21:05 МСК)');
  setInterval(() => {
    tick().catch((e) => console.error('cron tick', e?.message || e));
  }, 60_000);
}

async function tick() {
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' })
  );
  const hh = now.getHours();
  const mm = now.getMinutes();
  const date = todayMoscow();

  if (hh === 20 && mm === 0) await sendTomorrowReminders(date);

  const microHours = [10, 12, 14, 16, 18, 20];
  if (mm === 0 && microHours.includes(hh)) await sendMicroReports(date, hh);

  if (hh === 21 && mm === 5) await sendFinalReports(date);
}

async function sendTomorrowReminders(today: string) {
  const res = await query(
    `SELECT sch.*, e.full_name, e.telegram_id, st.name as store_name
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     LEFT JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date::date = ($1::date + interval '1 day')
       AND COALESCE(sch.hours,0) > 0
       AND e.telegram_id IS NOT NULL`,
    [today]
  );
  for (const r of res.rows) {
    await notifyUser(
      r.telegram_id,
      shiftReminder({
        employeeName: r.full_name,
        storeName: r.store_name || r.store_id,
        shiftText: r.shift_text || '',
        hours: r.hours,
        dateLabel: 'завтра'
      })
    );
  }
}

export async function sendMicroReports(date: string, hour?: number) {
  const chat = process.env.REPORT_CHAT_ID || process.env.CHAT_ID;
  if (!chat) {
    console.error('Микро: нет REPORT_CHAT_ID / CHAT_ID');
    return { ok: false, error: 'no_chat_id' };
  }
  try {
    const stores = await loadStorePlans(date);
    const h = hour ?? new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' })
    ).getHours();
    let sent = 0;
    for (const st of stores) {
      await sendStoreReportImage(st, date, 'micro', h);
      sent++;
      console.log('Микро-картинка:', st.name, h + ':00');
    }
    return { ok: true, sent };
  } catch (e: any) {
    console.error('micro report', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function sendFinalReports(date: string) {
  const chat = process.env.REPORT_CHAT_ID || process.env.CHAT_ID;
  if (!chat) {
    console.error('Итог: нет REPORT_CHAT_ID / CHAT_ID');
    return { ok: false, error: 'no_chat_id' };
  }
  try {
    const stores = await loadStorePlans(date);
    let sent = 0;
    for (const st of stores) {
      await sendStoreReportImage(st, date, 'final');
      sent++;
      console.log('Итог-картинка:', st.name);
    }
    return { ok: true, sent };
  } catch (e: any) {
    console.error('final report', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}
