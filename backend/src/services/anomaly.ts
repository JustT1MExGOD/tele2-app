/**
 * Anomaly Detection (19.2) — сравнение вчерашнего завершённого дня с тем,
 * что модель прогноза (services/forecast.ts, SES + сезонность дня недели)
 * ожидала бы для этого дня недели. Все существующие триггеры smart_alerts
 * (services/alerts.ts) — пороговые правила против ПЛАНА/фиксированного
 * числа; этот — единственный сигнал против ТИПИЧНОГО дня той же точки,
 * статистический (z-score), а не «меньше плана на N%».
 */
import { query } from '../db/index.js';
import { todayMoscow } from '../utils/date.js';
import { buildSesModel, projectDay } from './forecast.js';
import { insertAlertOnce } from './alerts.js';

function num(v: any) {
  return Number(v) || 0;
}

const Z_THRESHOLD = 2;
const Z_CRITICAL = 3;
const MIN_REAL_SAMPLES = 4; // меньше — по этому дню недели ещё не набралась история, не считаем

export async function checkAnomalyVsForecast() {
  const today = todayMoscow();
  const yesterdayDate = new Date(today + 'T12:00:00');
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  const yesterdayDow = yesterdayDate.getDay();

  const storesRes = await query(`SELECT id, name FROM stores WHERE COALESCE(is_active,true)=true`);
  const stores = storesRes.rows as { id: string; name: string }[];
  if (!stores.length) return { checked: 0, created: 0 };
  const storeIds = stores.map((s) => s.id);

  // История ДО вчера (вчера намеренно исключён — иначе день сравнивается сам с собой).
  const hist = await query(
    `SELECT store_id, sale_date::text as d,
            COALESCE(SUM(sim),0)+COALESCE(SUM(mnp),0)+COALESCE(SUM(pa),0)+COALESCE(SUM(combo),0) as total
     FROM sales
     WHERE store_id = ANY($1) AND sale_date >= ($2::date - interval '120 days') AND sale_date < $2::date
     GROUP BY store_id, sale_date`,
    [storeIds, yesterday]
  ).catch(() => ({ rows: [] as any[] }));

  const histByStore = new Map<string, Map<string, number>>();
  for (const r of hist.rows) {
    const d = String(r.d).slice(0, 10);
    if (!histByStore.has(r.store_id)) histByStore.set(r.store_id, new Map());
    histByStore.get(r.store_id)!.set(d, num(r.total));
  }

  const actualRes = await query(
    `SELECT store_id,
            COALESCE(SUM(sim),0)+COALESCE(SUM(mnp),0)+COALESCE(SUM(pa),0)+COALESCE(SUM(combo),0) as total
     FROM sales
     WHERE store_id = ANY($1) AND sale_date = $2::date
     GROUP BY store_id`,
    [storeIds, yesterday]
  );
  const actualByStore = new Map<string, number>();
  for (const r of actualRes.rows) actualByStore.set(r.store_id, num(r.total));

  let created = 0;
  for (const st of stores) {
    const byDate = histByStore.get(st.id);

    // Заполняем 120-дневное окно нулями на пропуски (та же дисциплина,
    // что forecastStore/forecastRemainingOfMonth), но отдельно считаем,
    // сколько из них — РЕАЛЬНЫЕ наблюдения по каждому дню недели: у
    // buildSesModel's sampleCount гап-филл-нули считаются наравне с
    // реальными днями, для гейта «достаточно ли данных» это не годится —
    // у совсем новой точки sampleCount всё равно был бы ~17 на день недели
    // из одних нулей.
    const rows: { dow: number; value: number }[] = [];
    const realCountByDow: Record<number, number> = {};
    const cursor = new Date(yesterday + 'T12:00:00');
    cursor.setDate(cursor.getDate() - 120);
    const end = new Date(yesterday + 'T12:00:00');
    while (cursor < end) {
      const key = cursor.toISOString().slice(0, 10);
      const dow = cursor.getDay();
      const has = byDate?.has(key);
      rows.push({ dow, value: has ? byDate!.get(key)! : 0 });
      if (has) realCountByDow[dow] = (realCountByDow[dow] || 0) + 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    if (!rows.length) continue;

    const realSamples = realCountByDow[yesterdayDow] || 0;
    if (realSamples < MIN_REAL_SAMPLES) continue;

    const model = buildSesModel(rows);
    const expected = projectDay(model, yesterdayDow);
    const actual = actualByStore.get(st.id) || 0;
    const spreadAbs = Math.max(model.level * model.spread[yesterdayDow], model.level * 0.2);
    if (spreadAbs <= 0) continue;
    const z = (actual - expected) / spreadAbs;
    if (Math.abs(z) < Z_THRESHOLD) continue;

    const isDip = z < 0;
    const title = isDip
      ? `${st.name}: необычно тихий день`
      : `${st.name}: необычный всплеск продаж`;
    const body = isDip
      ? `${yesterday}: факт ${Math.round(actual)} против типичных ~${Math.round(expected)} для этого дня недели (z=${z.toFixed(1)}). Стоит понять причину.`
      : `${yesterday}: факт ${Math.round(actual)} против типичных ~${Math.round(expected)} для этого дня недели (z=${z.toFixed(1)}). Стоит понять, что сработало, чтобы повторить.`;
    // Всплеск — хорошая новость по конструкции, не эскалируем как critical
    // (severity 'critical' у остальных триггеров триггерит уведомление
    // admin в runSmartAlertsTick) независимо от величины z.
    const severity = isDip && Math.abs(z) >= Z_CRITICAL ? 'critical' : 'warn';

    const alert = await insertAlertOnce({
      store_id: st.id,
      alert_type: 'anomaly_vs_forecast',
      severity,
      title,
      body,
      payload: { expected: Math.round(expected), actual, z: Number(z.toFixed(2)), dow: yesterdayDow, date: yesterday },
      alert_date: yesterday
    });
    if (alert) created++;
  }

  return { checked: stores.length, created };
}
