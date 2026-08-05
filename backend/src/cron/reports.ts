/**
 * Cron: микро/итог → картинка в чат сети точки.
 * Расписание отчётов (микро-часы, часы закрытия для финала) берётся из
 * самих точек (stores.micro_report_times / skip_sunday_micro_times /
 * close_time_weekday / close_time_sunday) — раньше дублировалось в TS-массиве
 * SCHEDULES, из-за чего новую точку нужно было вручную дописывать в код.
 */
import { query } from '../db/index.js';
import { todayMoscow } from '../utils/date.js';
import { getSalesSumColumns } from '../services/metrics-catalog.js';
import { notifyChat, notifyChatPhoto, notifyChatMediaGroup, notifyUser } from '../bot/index.js';
import { shiftReminder, microReport, finalReport, microLines, finalLines } from '../bot/messages.js';
import { buildDailyReportPng, buildDailyReportSvg, buildStoryReportPngs } from '../services/report-image.js';
import { generateDipComment } from '../services/ai.js';
import { materializeStoreDailyPlans } from '../services/plans.js';
import { getStoreChatId } from '../services/tenant.js';

// Раньше это была строка с жёстким списком из 15 колонок — любая
// кастомная метрика (заведённая через POST /metrics или руками в БД)
// молча пропадала из микро/итоговых отчётов в чат. Теперь список
// колонок берётся из реальной схемы таблицы sales.
async function factSql(): Promise<string> {
  const cols = await getSalesSumColumns();
  const select = cols.map((c) => `COALESCE(SUM(${c}),0) ${c}`).join(', ');
  return `SELECT ${select} FROM sales WHERE sale_date::date = $1::date AND store_id = $2`;
}

type StorePlanRow = {
  store_id: string;
  name: string;
  code: string;
  plan: any;
  micro_report_times: string[] | null;
  skip_sunday_micro_times: string[] | null;
  close_time_weekday: string | null;
  close_time_sunday: string | null;
};

function isSundayMoscow(now: Date): boolean {
  // getDay: 0 = Sunday
  return now.getDay() === 0;
}

const DEFAULT_MICRO_HOURS = [10, 12, 14, 16, 18, 20];
const DEFAULT_FINAL = { h: 21, m: 0 };

function parseHour(t: string): number {
  return parseInt(String(t).split(':')[0], 10);
}

/** Микро-часы точки; по воскресеньям вычитаются часы из skip_sunday_micro_times. */
function microHoursFor(st: StorePlanRow, sunday: boolean): number[] {
  const base =
    st.micro_report_times && st.micro_report_times.length
      ? st.micro_report_times.map(parseHour)
      : DEFAULT_MICRO_HOURS;
  if (!sunday) return base;
  const skip = new Set((st.skip_sunday_micro_times || []).map(parseHour));
  return base.filter((h) => !skip.has(h));
}

/** Время финального отчёта = время закрытия точки (будни/вс). */
function finalTimeFor(st: StorePlanRow, sunday: boolean): { h: number; m: number } {
  const raw = sunday ? st.close_time_sunday : st.close_time_weekday;
  if (!raw) return DEFAULT_FINAL;
  const [h, m] = String(raw).split(':').map((x) => parseInt(x, 10));
  return { h, m: m || 0 };
}

async function loadStorePlans(date: string): Promise<StorePlanRow[]> {
  const stores = await query(
    `SELECT id, name, code, micro_report_times, skip_sunday_micro_times,
            close_time_weekday, close_time_sunday
     FROM stores ORDER BY name`
  );
  const out: StorePlanRow[] = [];
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
      plan: planRes.rows[0] || {},
      micro_report_times: st.micro_report_times,
      skip_sunday_micro_times: st.skip_sunday_micro_times,
      close_time_weekday: st.close_time_weekday,
      close_time_sunday: st.close_time_sunday
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

  const chatId = await getStoreChatId(st.store_id);
  const hourLabel = hour != null ? `${String(hour).padStart(2, '0')}:00` : undefined;
  const caption = `📊 ${st.name} · ${date}${hourLabel ? ' · ' + hourLabel : ''}`;

  try {
    const { png } = await buildDailyReportPng(st.store_id, date, { kind: 'micro', hourLabel });
    const r = await notifyChatPhoto(png, {
      caption,
      filename: `micro_${st.store_id}_${date}.png`,
      chatId
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
        asDocument: true,
        chatId
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
      await notifyChat(text, chatId);
      return { ok: true, type: 'text_fallback' };
    }
  }
}

/** Итог дня — story-отчёт из 3 кадров (план → факт → фокус на завтра). */
async function sendStoreStoryReport(
  st: { store_id: string; name: string; code: string; plan: any },
  date: string
) {
  const chatId = await getStoreChatId(st.store_id);
  try {
    const { plan, fact, tomorrow } = await buildStoryReportPngs(st.store_id, date);

    const dayFact = await query(await factSql(), [date, st.store_id]).catch(() => ({ rows: [{}] }));
    const df = dayFact.rows[0] || {};
    // Полный факт/план точки (все ~18 метрик), а не только SIM/MNP/ПА/Комбо —
    // иначе просадка по остальным показателям для ИИ невидима.
    const comment = await generateDipComment({
      storeId: st.store_id,
      storeName: st.name,
      date,
      fact: df,
      dayPlan: st.plan
    });

    // Каждый кадр уже подписан заголовком внутри самой картинки (План дня /
    // Итоговый отчёт / Фокус на завтра) — не дублируем это в caption каждого
    // фото. Вместо трёх отдельных подписей — одно сообщение под всем альбомом.
    const r = await notifyChatMediaGroup(
      [
        { buffer: plan, filename: `plan_${st.store_id}_${date}.png` },
        { buffer: fact, filename: `fact_${st.store_id}_${date}.png` },
        { buffer: tomorrow, filename: `tomorrow_${st.store_id}_${date}.png` }
      ],
      { chatId }
    );
    if (!r.ok) throw new Error(r.error || 'media_group_failed');

    await notifyChat(`🏁 <b>${st.name}</b> · итог дня · ${date}\n\n${comment.text}`, chatId);
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
  const chatId = await getStoreChatId(st.store_id);
  const caption = `🏁 ${st.name} · ${date}`;
  try {
    const { png } = await buildDailyReportPng(st.store_id, date, { kind: 'final' });
    const r = await notifyChatPhoto(png, { caption, filename: `final_${st.store_id}_${date}.png`, chatId });
    if (r.ok) return r;
    throw new Error(r.error || 'photo_failed');
  } catch (e: any) {
    console.warn('Final PNG send failed, try SVG document:', e?.message || e);
    try {
      const svg = await buildDailyReportSvg(st.store_id, date, { kind: 'final' });
      return await notifyChatPhoto(svg, {
        caption,
        filename: `final_${st.store_id}_${date}.svg`,
        asDocument: true,
        chatId
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
      await notifyChat(text, chatId);
      return { ok: true, type: 'text_fallback' };
    }
  }
}

export function startReportCron() {
  console.log('📅 Cron T2: отчёты по точкам — расписание берётся из stores (micro_report_times / close_time_*)');
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

  // Дневные планы точек раньше материализовались только вручную кнопкой
  // «Записать дневные планы в БД» — если никто не нажал, store_plans на
  // сегодня/завтра просто нет, и отчёты/«Фокус на завтра» рендерятся
  // пустыми (факт 0, план «—»). Автоматически считаем оба дня рано утром.
  if (hh === 6 && mm === 0) {
    const tomorrow = new Date(date + 'T12:00:00');
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    await materializeStoreDailyPlans(date).catch((e) => console.error('auto-materialize today', e?.message || e));
    await materializeStoreDailyPlans(tomorrowStr).catch((e) => console.error('auto-materialize tomorrow', e?.message || e));
  }

  const stores = await loadStorePlans(date);

  for (const st of stores) {
    const micros = microHoursFor(st, sunday);
    if (mm === 0 && micros.includes(hh)) {
      await sendStoreReportImage(st, date, 'micro', hh);
      console.log('Микро-картинка:', st.name, hh + ':00');
    }

    const fin = finalTimeFor(st, sunday);
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
