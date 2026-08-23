/**
 * Инсайты смены: отставание от плана, типичный трафик точки, сравнение с собой.
 */
import { todayMoscow } from '../../utils/date.js';
import * as repo from '../../data/repositories/insights.js';

function num(v: any) {
  return Number(v) || 0;
}

/** Профиль часов точки: доля продаж по часам для дня недели */
export async function getStoreHourWeights(storeId: string, dow: number) {
  const rows = await repo.findHourProfile(storeId, dow);
  if (rows.length) {
    return rows.map((r: any) => ({ hour: Number(r.hour), weight: num(r.weight) }));
  }
  // fallback: рабочие 10–21 равномерно
  const hours = [];
  for (let h = 10; h <= 21; h++) hours.push({ hour: h, weight: 1 });
  return hours;
}

/** Дневной план, разбитый на «до обеда / после» и по часам */
export async function splitDayPlanByHours(opts: {
  storeId: string;
  date: string; // YYYY-MM-DD
  dayPlan: Record<string, number>; // sim, mnp, ...
}) {
  const dow = new Date(opts.date + 'T12:00:00').getDay();
  const weights = await getStoreHourWeights(opts.storeId, dow);
  const totalW = weights.reduce((s, w) => s + w.weight, 0) || 1;

  const byHour: Record<number, Record<string, number>> = {};
  for (const w of weights) {
    byHour[w.hour] = {};
    for (const [metric, plan] of Object.entries(opts.dayPlan)) {
      byHour[w.hour][metric] = Math.ceil((num(plan) * w.weight) / totalW);
    }
  }

  const morningHours = weights.filter((w) => w.hour < 15);
  const eveningHours = weights.filter((w) => w.hour >= 15);
  const sumBlock = (block: typeof weights) => {
    const bw = block.reduce((s, x) => s + x.weight, 0) || 1;
    const out: Record<string, number> = {};
    for (const [metric, plan] of Object.entries(opts.dayPlan)) {
      out[metric] = Math.ceil((num(plan) * bw) / totalW);
    }
    return out;
  };

  return {
    by_hour: byHour,
    before_lunch: sumBlock(morningHours),
    after_lunch: sumBlock(eveningHours),
    lunch_hour: 15
  };
}

/** Инсайт «ты отстаёшь / точка обычно растёт после 16» */
export async function buildShiftInsight(opts: {
  employeeId: number;
  storeId: string;
  date: string;
  fact: Record<string, number>;
  dayPlan: Record<string, number>;
}) {
  const nowHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      hour12: false
    }).format(new Date())
  );

  const split = await splitDayPlanByHours({
    storeId: opts.storeId,
    date: opts.date,
    dayPlan: opts.dayPlan
  });

  // ожидаемый % к текущему часу
  const weights = await getStoreHourWeights(
    opts.storeId,
    new Date(opts.date + 'T12:00:00').getDay()
  );
  const totalW = weights.reduce((s, w) => s + w.weight, 0) || 1;
  const elapsedW = weights.filter((w) => w.hour < nowHour).reduce((s, w) => s + w.weight, 0);
  const expectedPct = Math.round((elapsedW / totalW) * 100);

  const keyMetrics = ['sim', 'mnp', 'pa', 'combo'] as const;
  let factUnits = 0;
  let planUnits = 0;
  for (const m of keyMetrics) {
    factUnits += num(opts.fact[m]);
    planUnits += num(opts.dayPlan[m]);
  }
  const actualPct = planUnits > 0 ? Math.round((factUnits / planUnits) * 100) : 0;
  const gap = expectedPct - actualPct;

  let message = '';
  let focus: string[] = [];

  if (gap >= 15) {
    message = `Ты на ~${actualPct}% плана при типичных ~${expectedPct}% к ${nowHour}:00. Отставание ~${gap} п.п.`;
    // где точка обычно сильнее дальше
    const future = weights.filter((w) => w.hour >= nowHour).sort((a, b) => b.weight - a.weight);
    if (future[0]) {
      message += ` На этой точке обычно пик около ${future[0].hour}:00 — лови трафик.`;
      focus.push(`Фокус на ${future[0].hour}:00–${future[0].hour + 1}:00`);
    }
    if (num(opts.dayPlan.mnp) > 0 && num(opts.fact.mnp) === 0) {
      focus.push('Ещё нет MNP — спроси про перенос номера');
    }
  } else if (actualPct >= 100) {
    message = `План по ключевым метрикам закрыт (${actualPct}%). Можно добивать аксы и допродажи.`;
    focus.push('Идеальная смена: удержи качество и кассу');
  } else {
    message = `Темп нормальный: ~${actualPct}% при ожидаемых ~${expectedPct}% к этому часу.`;
  }

  return {
    actual_pct: actualPct,
    expected_pct: expectedPct,
    gap,
    hour: nowHour,
    message,
    focus,
    split
  };
}

/** Сравнение с собой: 7 и 30 дней + лучшая смена */
export async function selfComparison(employeeId: number) {
  const today = todayMoscow();

  const days = await repo.findDailySalesHistory(employeeId, today);

  const rows = days.map((r: any) => ({
    date: String(r.d).slice(0, 10),
    sim: num(r.sim),
    mnp: num(r.mnp),
    pa: num(r.pa),
    combo: num(r.combo),
    phones: num(r.phones),
    accessories: num(r.accessories),
    score: num(r.sim) + num(r.mnp) * 2 + num(r.pa) * 3 + num(r.combo) * 2
  }));

  const last7 = rows.filter((r) => r.date >= addDays(today, -6));
  const last30 = rows;

  const avg = (arr: typeof rows) => {
    if (!arr.length) return { sim: 0, mnp: 0, score: 0 };
    const n = arr.length;
    return {
      sim: Math.round(arr.reduce((s, x) => s + x.sim, 0) / n),
      mnp: Math.round((arr.reduce((s, x) => s + x.mnp, 0) / n) * 10) / 10,
      score: Math.round(arr.reduce((s, x) => s + x.score, 0) / n)
    };
  };

  const best = rows.slice().sort((a, b) => b.score - a.score)[0] || null;
  const todayRow = rows.find((r) => r.date === today) || null;

  return {
    today: todayRow,
    avg_7: avg(last7),
    avg_30: avg(last30),
    best_shift: best,
    series_7: last7,
    series_30: last30
  };
}

function addDays(iso: string, delta: number) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Пересчёт hour profile из истории sales (если есть timestamp — иначе равномерно по сменам) */
export async function rebuildHourProfiles() {
  // Без точного часа продажи строим прокси: равномерный вес 10–21
  const storeIds = await repo.listActiveStoreIds();
  for (const storeId of storeIds) {
    for (let dow = 0; dow <= 6; dow++) {
      for (let hour = 10; hour <= 21; hour++) {
        // чуть выше вес 12–14 и 17–19
        let w = 1;
        if (hour >= 12 && hour <= 14) w = 1.3;
        if (hour >= 17 && hour <= 19) w = 1.4;
        await repo.upsertHourWeight(storeId, dow, hour, w);
      }
    }
  }
  return { ok: true, stores: storeIds.length };
}
