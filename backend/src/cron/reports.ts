/**
 * Cron: микро/итог → картинка в чат сети точки.
 * Расписание отчётов (микро-часы, часы закрытия для финала) берётся из
 * самих точек (stores.micro_report_times / skip_sunday_micro_times /
 * close_time_weekday / close_time_sunday) — раньше дублировалось в TS-массиве
 * SCHEDULES, из-за чего новую точку нужно было вручную дописывать в код.
 */
import { todayMoscow } from '../utils/date.js';
import { getSalesSumColumns } from '../core/shared/metrics-catalog.js';
import { notifyChat, notifyChatPhoto, notifyChatMediaGroup, notifyUser } from '../integrations/telegram/bot.js';
import { shiftReminder, microReport, finalReport, microLines, finalLines, monthClosingReport, esc } from '../integrations/telegram/messages.js';
import { buildDailyReportPng, buildDailyReportSvg, buildStoryReportPngs, buildMonthClosingReportPng, buildMonthClosingReportSvg, loadMonthClosingData } from '../core/reports/image.js';
import { generateDipComment } from '../integrations/ai/client.js';
import { materializeStoreDailyPlans } from '../core/plans/index.js';
import { rebuildHourProfiles } from '../core/analytics/heatmap.js';
import { getStoreNotifyTarget } from '../core/shared/tenant.js';
import * as cronRepo from '../data/repositories/cron.js';
import * as reportImageRepo from '../data/repositories/report-image.js';
import { runJob } from './job-logger.js';

// Раньше это была строка с жёстким списком из 15 колонок — любая
// кастомная метрика (заведённая через POST /metrics или руками в БД)
// молча пропадала из микро/итоговых отчётов в чат. Теперь список
// колонок берётся из реальной схемы таблицы sales.
async function factSumColsSql(): Promise<string> {
  const cols = await getSalesSumColumns();
  return cols.map((c) => `COALESCE(SUM(${c}),0) ${c}`).join(', ');
}

/** true — событие claim'нуто впервые (можно отправлять), false — уже было
 * отправлено (кто-то другой уже забрал этот же ключ, пропускаем). */
export async function claimCronSend(key: string): Promise<boolean> {
  return cronRepo.claimSend(key);
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

async function loadStorePlans(date: string): Promise<StorePlanRow[]> {
  const stores = await cronRepo.listStoresForReportSchedule();
  const out: StorePlanRow[] = [];
  for (const st of stores) {
    const plan = await cronRepo.findDayOrTemplatePlanResilient(st.id, date);
    out.push({
      store_id: st.id,
      name: st.name,
      code: st.code,
      plan: plan || {},
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
  hour?: number | string
) {
  if (kind === 'final') return sendStoreStoryReport(st, date);

  const { chatId, threadId } = await getStoreNotifyTarget(st.store_id, 'reports');
  const hourLabel = hour == null ? undefined : typeof hour === 'string' ? hour : `${String(hour).padStart(2,'0')}:00`;
  const caption = `📊 ${st.name} · ${date}${hourLabel ? ' · запланирован на ' + hourLabel + '; данные на момент отправки' : ''}`;

  try {
    const { png } = await buildDailyReportPng(st.store_id, date, { kind: 'micro', hourLabel });
    const r = await notifyChatPhoto(png, {
      caption,
      filename: `micro_${st.store_id}_${date}.png`,
      chatId,
      threadId
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
        chatId,
        threadId
      });
    } catch (e2: any) {
      console.warn('SVG also failed, text fallback:', e2?.message || e2);
      const staffNames = await cronRepo.listStaffNamesUnordered(date, st.store_id);
      const sumColsSql = await factSumColsSql();
      const f = await reportImageRepo.sumDayFactColumns(st.store_id, date, sumColsSql);
      const lines = await microLines(f, st.plan);
      const text = microReport({
        storeName: st.name,
        storeCode: st.code || st.store_id,
        date: `${date}${hourLabel ? ' · ' + hourLabel : ''}`,
        staff: staffNames,
        lines
      });
      await notifyChat(text, chatId, threadId,true);
      return { ok: true, type: 'text_fallback' };
    }
  }
}

/** Итог дня — story-отчёт из 3 кадров (план → факт → фокус на завтра). */
async function sendStoreStoryReport(
  st: { store_id: string; name: string; code: string; plan: any },
  date: string
) {
  const { chatId, threadId } = await getStoreNotifyTarget(st.store_id, 'reports');
  try {
    const { plan, fact, tomorrow } = await buildStoryReportPngs(st.store_id, date);

    const sumColsSql = await factSumColsSql();
    const df = await reportImageRepo.sumDayFactColumns(st.store_id, date, sumColsSql);
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
      { chatId, threadId }
    );
    if (!r.ok) throw new Error(r.error || 'media_group_failed');

    // Security audit (20.52.0) — оба поля раньше шли в parse_mode:'HTML'
    // сообщение без esc(): st.name (кастомное название точки, admin-
    // controlled) и comment.text (AI-сгенерированный текст, Groq) — оба
    // потенциально ломают Telegram HTML-разметку или (для AI-текста)
    // внедряют её намеренно через prompt injection в исходных данных.
    await notifyChat(`🏁 <b>${esc(st.name)}</b> · итог дня · ${date}\n\n${esc(comment.text)}`, chatId, threadId,true);
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
  const { chatId, threadId } = await getStoreNotifyTarget(st.store_id, 'reports');
  const caption = `🏁 ${st.name} · ${date}`;
  try {
    const { png } = await buildDailyReportPng(st.store_id, date, { kind: 'final' });
    const r = await notifyChatPhoto(png, { caption, filename: `final_${st.store_id}_${date}.png`, chatId, threadId });
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
        chatId,
        threadId
      });
    } catch (e2: any) {
      console.warn('SVG also failed, text fallback:', e2?.message || e2);
      const staffNames = await cronRepo.listStaffNamesUnordered(date, st.store_id);
      const sumColsSql = await factSumColsSql();
      const f = await reportImageRepo.sumDayFactColumns(st.store_id, date, sumColsSql);
      const lines = await finalLines(f, st.plan);
      const text = finalReport({
        storeName: st.name,
        storeCode: st.code || st.store_id,
        date,
        staff: staffNames,
        lines
      });
      await notifyChat(text, chatId, threadId,true);
      return { ok: true, type: 'text_fallback' };
    }
  }
}

/** Ежедневный отчёт «закрытие месяца» (с 16 числа, при открытии точки) —
 * PNG→SVG→текст, тот же фолбэк-паттерн, что у micro/final отчётов. */
async function sendMonthClosingReport(st: { store_id: string; name: string; code: string }, date: string) {
  const { chatId, threadId } = await getStoreNotifyTarget(st.store_id, 'reports');
  const caption = `📆 ${st.name} · закрытие месяца · ${date}`;
  try {
    const { png } = await buildMonthClosingReportPng(st.store_id, date);
    const r = await notifyChatPhoto(png, { caption, filename: `month_closing_${st.store_id}_${date}.png`, chatId, threadId });
    if (r.ok) return r;
    throw new Error(r.error || 'photo_failed');
  } catch (e: any) {
    console.warn('Month-closing PNG send failed, try SVG document:', e?.message || e);
    try {
      const svg = await buildMonthClosingReportSvg(st.store_id, date);
      return await notifyChatPhoto(svg, {
        caption,
        filename: `month_closing_${st.store_id}_${date}.svg`,
        asDocument: true,
        chatId,
        threadId
      });
    } catch (e2: any) {
      console.warn('SVG also failed, text fallback:', e2?.message || e2);
      const { rows, totalDays, dayNum } = await loadMonthClosingData(st.store_id, date);
      const text = monthClosingReport({ storeName: st.name, storeCode: st.code || st.store_id, date, dayNum, totalDays, rows });
      await notifyChat(text, chatId, threadId, true);
      return { ok: true, type: 'text_fallback' };
    }
  }
}

/** Возвращает handle — graceful shutdown (index.ts) должен уметь снять
 * таймер, иначе процесс может тикнуть ещё раз в процессе останова. */
export function startReportCron(): NodeJS.Timeout {
  let busy=false;
  const run=async () => {
    if(busy) return;
    busy=true;
    try { await tick(); } catch(e) { console.error('report scheduler',e); } finally { busy=false; }
  };
  void run();
  return setInterval(() => { void run(); },60_000);
}

export function reportTime(raw:string): string | null {
  const match=/^(\d{1,2})(?::(\d{2}))?(?::00)?$/.exec(raw);
  if(!match || Number(match[1])>23 || Number(match[2] || 0)>59) return null;
  return `${match[1].padStart(2,'0')}:${match[2] || '00'}`;
}

async function tick() {
  const date=todayMoscow();
  const stores=await cronRepo.listStoresForReportSchedule();
  const jobs:{key:string;due_at:string;payload:any}[]=[];
  const add=(key:string,time:string,payload:any) => jobs.push({key,due_at:`${date}T${time}:00+03:00`,payload:{date,...payload}});
  add(`tomorrow_reminders:${date}`,'20:00',{kind:'reminders'});
  add(`rebuild_hour_profiles:${date}`,'05:00',{kind:'profiles'});
  add(`materialize:${date}`,'06:00',{kind:'plans'});
  const sunday=new Date(date+'T12:00:00Z').getUTCDay()===0;
  for(const st of stores) {
    const times=(st.micro_report_times?.length ? st.micro_report_times : ['10:00','12:00','14:00','16:00','18:00','20:00']).map(reportTime).filter(Boolean) as string[];
    const skip=new Set((st.skip_sunday_micro_times || []).map(reportTime));
    for(const time of times) {
      if(sunday && skip.has(time)) continue;
      // Preserve legacy key for whole-hour reports already sent before upgrade.
      const suffix=time.endsWith(':00') ? String(Number(time.slice(0,2))) : time;
      add(`micro:${st.id}:${date}:${suffix}`,time,{kind:'micro',store_id:st.id,time});
    }
    const final=reportTime(String((sunday ? st.close_time_sunday : st.close_time_weekday) || '21:00'));
    if(final) add(`final:${st.id}:${date}`,final,{kind:'final',store_id:st.id});

    // Закрытие месяца: с 16 числа по конец месяца, раз в день, при открытии точки.
    if (Number(date.slice(8, 10)) >= 16) {
      const open = reportTime(String((sunday ? (st as any).open_time_sunday : (st as any).open_time_weekday) || '09:00'));
      if (open) add(`month_closing:${st.id}:${date}`, open, { kind: 'month_closing', store_id: st.id });
    }
  }
  await cronRepo.enqueueReportJobs(jobs);
  // Bounded work per tick; other replicas claim different rows. Missed ticks
  // and already queued previous-day jobs are recovered after restart.
  for(let n=0;n<20;n++) {
    const job=await cronRepo.claimReportJob();
    if(!job) break;
    const p=job.payload;
    await runJob(`report.${p.kind}`,async () => {
    try {
      if(p.kind==='profiles') await rebuildHourProfiles();
      else if(p.kind==='plans') {
        await materializeStoreDailyPlans(p.date);
        const tomorrow=new Date(p.date+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
        await materializeStoreDailyPlans(tomorrow.toISOString().slice(0,10));
      } else if(p.kind==='reminders') await sendTomorrowReminders(p.date);
      else if(p.kind==='month_closing') {
        const st=stores.find(st=>st.id===p.store_id);
        if(!st) throw new Error('Report store no longer exists');
        const result=await sendMonthClosingReport({store_id:st.id,name:st.name,code:st.code},p.date);
        if(!result?.ok) throw new Error('Report delivery failed');
      }
      else {
        const st=stores.find(st=>st.id===p.store_id);
        if(!st) throw new Error('Report store no longer exists');
        const plan=await cronRepo.findDayOrTemplatePlanResilient(st.id,p.date);
        const result=await sendStoreReportImage({...st,store_id:st.id,plan},p.date,p.kind,p.time);
        if(!result?.ok) throw new Error('Report delivery failed');
      }
      await cronRepo.finishReportJob(job.key,job.attempts);
    } catch(e:any) {
      await cronRepo.finishReportJob(job.key,job.attempts,String(e?.message || e).slice(0,1000));
      throw e;
    }
    });
  }
}

async function sendTomorrowReminders(today: string) {
  const rows = await cronRepo.listTomorrowShiftsForReminders(today);
  for (const r of rows) {
    await notifyUser(
      r.telegram_id,
      shiftReminder({
        employeeName: r.full_name,
        storeName: r.store_name || r.store_id,
        shiftText: r.shift_text || '',
        hours: r.hours,
        dateLabel: String(r.work_date).slice(0,10)
      }),true
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
      const result=await sendStoreReportImage(st, date, 'micro', h);
      if(!result?.ok) throw new Error('Report delivery failed');
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
      const result=await sendStoreReportImage(st, date, 'final');
      if(!result?.ok) throw new Error('Report delivery failed');
      sent++;
      console.log('Итог-картинка:', st.name);
    }
    return { ok: true, sent };
  } catch (e: any) {
    console.error('final report', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}
