/**
 * Cron: микро/итог → картинка в REPORT_CHAT_ID
 * Расписание по точкам (МСК):
 *
 * Космонавтов 20А:  микро 12,14,16,18,20  | финал 21:00
 * Калинина 2:       пн–сб микро 10,12,14,16,18,20 | финал 20:45
 *                   вс     микро 10,12,14,16,18    | финал 19:45
 * Калинина 11:      микро 10,12,14,16,18,20 | финал 22:00
 */
import { query } from '../db/index.js';
import { todayMoscow } from '../utils/date.js';
import { getSalesSumColumns } from '../services/metrics-catalog.js';
import { notifyChat, notifyChatPhoto, notifyChatMediaGroup, notifyUser } from '../bot/index.js';
import { shiftReminder, microReport, finalReport, microLines, finalLines } from '../bot/messages.js';
import { buildDailyReportPng, buildDailyReportSvg, buildStoryReportPngs } from '../services/report-image.js';
import { generateDipComment } from '../services/ai.js';

// Раньше это была строка с жёстким списком из 15 колонок — любая
// кастомная метрика (заведённая через POST /metrics или руками в БД)
// молча пропадала из микро/итоговых отчётов в чат. Теперь список
// колонок берётся из реальной схемы таблицы sales.
async function factSql(): Promise<string> {
  const cols = await getSalesSumColumns();
  const select = cols.map((c) => `COALESCE(SUM(${c}),0) ${c}`).join(', ');
  return `SELECT ${select} FROM sales WHERE sale_date::date = $1::date AND store_id = $2`;
}

/** Расписание одной точки */
type StoreSchedule = {
  /** id в stores, либо несколько алиасов */
  ids: string[];
  /** микро-часы пн–сб */
  micro: number[];
  /** микро-часы вс (если не задано — как micro) */
  microSun?: number[];
  /** финал пн–сб: hour, minute */
  final: { h: number; m: number };
  /** финал вс (если не задано — как final) */
  finalSun?: { h: number; m: number };
};

const SCHEDULES: StoreSchedule[] = [
  {
    ids: ['kosmonavtov'],
    micro: [12, 14, 16, 18, 20],
    final: { h: 21, m: 0 }
  },
  {
    ids: ['kalinina2'],
    micro: [10, 12, 14, 16, 18, 20],
    microSun: [10, 12, 14, 16, 18],
    final: { h: 20, m: 45 },
    finalSun: { h: 19, m: 45 }
  },
  {
    ids: ['kalinina11'],
    micro: [10, 12, 14, 16, 18, 20],
    final: { h: 22, m: 0 }
  }
];

function isSundayMoscow(now: Date): boolean {
  // getDay: 0 = Sunday
  return now.getDay() === 0;
}

function scheduleForStore(storeId: string): StoreSchedule | null {
  const id = String(storeId || '').toLowerCase();
  return (
    SCHEDULES.find((s) => s.ids.some((x) => x.toLowerCase() === id)) || null
  );
}

function microHoursFor(sch: StoreSchedule, sunday: boolean): number[] {
  if (sunday && sch.microSun) return sch.microSun;
  return sch.micro;
}

function finalTimeFor(sch: StoreSchedule, sunday: boolean): { h: number; m: number } {
  if (sunday && sch.finalSun) return sch.finalSun;
  return sch.final;
}

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
  if (kind === 'final') return sendStoreStoryReport(st, date);

  const hourLabel = hour != null ? `${String(hour).padStart(2, '0')}:00` : undefined;
  const caption = `📊 ${st.name} · ${date}${hourLabel ? ' · ' + hourLabel : ''}`;

  try {
    const { png } = await buildDailyReportPng(st.store_id, date, { kind: 'micro', hourLabel });
    const r = await notifyChatPhoto(png, {
      caption,
      filename: `micro_${st.store_id}_${date}.png`
    });
    if (r.ok) return r;
    throw new Error(r.error || 'photo_failed');
  } catch (e: any) {
    console.warn('PNG send failed, try SVG document:', e?.message || e);
    try {
      const svg = await buildDailyReportSvg(st.store_id, date, { kind: 'micro', hourLabel });
      return await notifyChatPhoto(svg, {
        caption,
        filename: `micro_${st.store_id}_${date}.svg`,
        asDocument: true
      });
    } catch (e2: any) {
      console.warn('SVG also failed, text fallback:', e2?.message || e2);
      const staff = await query(
        `SELECT e.full_name FROM schedules sch
         JOIN employees e ON e.id = sch.employee_id
         WHERE sch.work_date::date = $1::date AND sch.store_id = $2 AND COALESCE(sch.hours,0)>0`,
        [date, st.store_id]
      );
      const fact = await query(await factSql(), [date, st.store_id]).catch(() => ({ rows: [{}] }));
      const f = fact.rows[0] || {};
      const lines = await microLines(f, st.plan);
      const text = microReport({
        storeName: st.name,
        storeCode: st.code || st.store_id,
        date: `${date}${hourLabel ? ' · ' + hourLabel : ''}`,
        staff: staff.rows.map((x: any) => x.full_name),
        lines
      });
      await notifyChat(text);
      return { ok: true, type: 'text_fallback' };
    }
  }
}

/** Итог дня — story-отчёт из 3 кадров (план → факт → фокус на завтра). */
async function sendStoreStoryReport(
  st: { store_id: string; name: string; code: string; plan: any },
  date: string
) {
  try {
    const { plan, fact, tomorrow } = await buildStoryReportPngs(st.store_id, date);

    const dayFact = await query(await factSql(), [date, st.store_id]).catch(() => ({ rows: [{}] }));
    const df = dayFact.rows[0] || {};
    const comment = await generateDipComment({
      storeId: st.store_id,
      storeName: st.name,
      date,
      fact: { sim: df.sim, mnp: df.mnp, pa: df.pa, combo: df.combo },
      dayPlan: { sim: st.plan.sim, mnp: st.plan.mnp, pa: st.plan.pa, combo: st.plan.combo }
    });

    // Каждый кадр уже подписан заголовком внутри самой картинки (План дня /
    // Итоговый отчёт / Фокус на завтра) — не дублируем это в caption каждого
    // фото. Вместо трёх отдельных подписей — одно сообщение под всем альбомом.
    const r = await notifyChatMediaGroup([
      { buffer: plan, filename: `plan_${st.store_id}_${date}.png` },
      { buffer: fact, filename: `fact_${st.store_id}_${date}.png` },
      { buffer: tomorrow, filename: `tomorrow_${st.store_id}_${date}.png` }
    ]);
    if (!r.ok) throw new Error(r.error || 'media_group_failed');

    await notifyChat(`🏁 <b>${st.name}</b> · итог дня · ${date}\n\n${comment.text}`);
    return r;
  } catch (e: any) {
    console.warn('Story report failed, fallback to single final image:', e?.message || e);
    return sendSingleFinalImage(st, date);
  }
}

/** Старое поведение kind='final' — фолбэк, если story (media group) не отправился. */
async function sendSingleFinalImage(
  st: { store_id: string; name: string; code: string; plan: any },
  date: string
) {
  const caption = `🏁 ${st.name} · ${date}`;
  try {
    const { png } = await buildDailyReportPng(st.store_id, date, { kind: 'final' });
    const r = await notifyChatPhoto(png, { caption, filename: `final_${st.store_id}_${date}.png` });
    if (r.ok) return r;
    throw new Error(r.error || 'photo_failed');
  } catch (e: any) {
    console.warn('Final PNG send failed, try SVG document:', e?.message || e);
    try {
      const svg = await buildDailyReportSvg(st.store_id, date, { kind: 'final' });
      return await notifyChatPhoto(svg, {
        caption,
        filename: `final_${st.store_id}_${date}.svg`,
        asDocument: true
      });
    } catch (e2: any) {
      console.warn('SVG also failed, text fallback:', e2?.message || e2);
      const staff = await query(
        `SELECT e.full_name FROM schedules sch
         JOIN employees e ON e.id = sch.employee_id
         WHERE sch.work_date::date = $1::date AND sch.store_id = $2 AND COALESCE(sch.hours,0)>0`,
        [date, st.store_id]
      );
      const fact = await query(await factSql(), [date, st.store_id]).catch(() => ({ rows: [{}] }));
      const f = fact.rows[0] || {};
      const lines = await finalLines(f, st.plan);
      const text = finalReport({
        storeName: st.name,
        storeCode: st.code || st.store_id,
        date,
        staff: staff.rows.map((x: any) => x.full_name),
        lines
      });
      await notifyChat(text);
      return { ok: true, type: 'text_fallback' };
    }
  }
}

export function startReportCron() {
  console.log(
    '📅 Cron T2: отчёты по точкам — kosmo 12–20/21:00, kal2 10–20/20:45 (вс 19:45), kal11 10–20/22:00'
  );
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
  const sunday = isSundayMoscow(now);

  // напоминания о завтрашней смене — как было
  if (hh === 20 && mm === 0) await sendTomorrowReminders(date);

  const stores = await loadStorePlans(date);

  for (const st of stores) {
    const sch = scheduleForStore(st.store_id);
    if (!sch) {
      // неизвестная точка — дефолт: микро каждый чётный час 10–20, финал 21:00
      if (mm === 0 && [10, 12, 14, 16, 18, 20].includes(hh)) {
        await sendStoreReportImage(st, date, 'micro', hh);
        console.log('Микро (default):', st.name, hh + ':00');
      }
      if (hh === 21 && mm === 0) {
        await sendStoreReportImage(st, date, 'final');
        console.log('Итог (default):', st.name);
      }
      continue;
    }

    const micros = microHoursFor(sch, sunday);
    if (mm === 0 && micros.includes(hh)) {
      await sendStoreReportImage(st, date, 'micro', hh);
      console.log('Микро-картинка:', st.name, hh + ':00');
    }

    const fin = finalTimeFor(sch, sunday);
    if (hh === fin.h && mm === fin.m) {
      await sendStoreReportImage(st, date, 'final');
      console.log('Итог-картинка:', st.name, `${fin.h}:${String(fin.m).padStart(2, '0')}`);
    }
  }
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

/** Ручной запуск: все точки, микро за текущий час */
export async function sendMicroReports(date: string, hour?: number) {
  const chat = process.env.REPORT_CHAT_ID || process.env.CHAT_ID;
  if (!chat) {
    console.error('Микро: нет REPORT_CHAT_ID / CHAT_ID');
    return { ok: false, error: 'no_chat_id' };
  }
  try {
    const stores = await loadStorePlans(date);
    const h =
      hour ??
      new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' })).getHours();
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

/** Ручной запуск: итог по всем точкам */
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
