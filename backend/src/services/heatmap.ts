/**
 * Точный heatmap по часу продажи (МСК) из sales_events.
 * Fallback: store_hour_profile + равномерное распределение дневных sales.
 */
import * as repo from '../repositories/heatmap.js';

function num(v: any) {
  return Number(v) || 0;
}

/** Текущий час в МСК 0–23 */
export function hourMoscow(d = new Date()): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    hour12: false
  });
  return Number(fmt.format(d)) % 24;
}

/** Записать события по метрикам (после успешного POST /sales) */
export async function logSaleEvents(opts: {
  employee_id: number;
  store_id: string;
  sale_date: string;
  metrics: Record<string, number>;
  source?: string;
  hour?: number;
}) {
  const hour = opts.hour ?? hourMoscow();
  const source = opts.source || 'api';
  for (const [metric, delta] of Object.entries(opts.metrics)) {
    const v = num(delta);
    if (!v) continue;
    await repo.insertEvent(opts.employee_id, opts.store_id, opts.sale_date, hour, metric, v, source);
  }
}

export async function salesHeatmap(storeId: string, weeks = 4) {
  const eventRows = await repo.findHourTotals(storeId, weeks);

  const byHour: Record<number, { hour: number; sim: number; mnp: number; pa: number; combo: number; total: number }> = {};
  for (let h = 0; h < 24; h++) {
    byHour[h] = { hour: h, sim: 0, mnp: 0, pa: 0, combo: 0, total: 0 };
  }
  for (const r of eventRows) {
    const h = Number(r.hour);
    if (!byHour[h]) continue;
    const m = String(r.metric);
    const t = num(r.total);
    if (m === 'sim') byHour[h].sim += t;
    else if (m === 'mnp') byHour[h].mnp += t;
    else if (m === 'pa') byHour[h].pa += t;
    else if (m === 'combo') byHour[h].combo += t;
    byHour[h].total += t;
  }

  const hours = Object.values(byHour);
  const maxTotal = Math.max(1, ...hours.map((x) => x.total));
  const cells = hours.map((x) => ({
    ...x,
    intensity: Math.round((x.total / maxTotal) * 100) / 100
  }));

  // dow × hour matrix for richer UI
  const matrix = await repo.findDowHourMatrix(storeId, weeks);

  const hasEvents = eventRows.length > 0;
  let note = 'Точный heatmap по sales_events (час МСК)';
  if (!hasEvents) {
    note = 'Пока нет sales_events — внесите продажи после v14, чтобы наполнить heatmap';
  }

  return {
    store_id: storeId,
    weeks,
    precise: hasEvents,
    hours: cells,
    matrix,
    note
  };
}

/** Пересчёт store_hour_profile из events */
export async function rebuildHourProfiles(storeId?: string) {
  await repo.deleteHourProfiles(storeId || null);
  await repo.rebuildHourProfilesFromEvents(storeId || null);
  return { ok: true };
}
