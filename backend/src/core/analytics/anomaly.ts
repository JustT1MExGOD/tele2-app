/**
 * Anomaly Detection (19.2) — сравнение вчерашнего завершённого дня с тем,
 * что модель прогноза (services/forecast.ts, SES + сезонность дня недели)
 * ожидала бы для этого дня недели. Все существующие триггеры smart_alerts
 * (services/alerts.ts) — пороговые правила против ПЛАНА/фиксированного
 * числа; этот — единственный сигнал против ТИПИЧНОГО дня той же точки,
 * статистический (z-score), а не «меньше плана на N%».
 */
import { todayMoscow } from '../../utils/date.js';
import { buildSesModel, projectDay } from './forecast.js';
import { insertAlertOnce } from '../alerts/service.js';
import * as storesRepo from '../../data/repositories/stores.js';
import * as salesRepo from '../../data/repositories/sales.js';
import * as schedulesRepo from '../../data/repositories/schedules.js';
import * as shiftsRepo from '../../data/repositories/shifts.js';

function num(v: any) {
  return Number(v) || 0;
}

const Z_THRESHOLD = 2;
const Z_CRITICAL = 3;
const MIN_REAL_SAMPLES = 4; // меньше — по этому дню недели ещё не набралась история, не считаем

/**
 * Explain (21.0) — почему точка проседала, без LLM: три детерминированных,
 * проверяемых по своим данным фактора, а не догадка. Считаются только для
 * "тихих" дней (isDip) — всплеск не нуждается в объяснении по смыслу
 * фичи ("почему НЕДОработала"). Если ни один фактор не сработал — пустой
 * массив, это тоже полезный сигнал ("проверили известные причины, ни одна
 * не объясняет — смотрите на месте"), а не молчание.
 */
const UNDERSTAFF_RATIO = 0.75; // факт headcount ниже этой доли от типичного — считаем недоукомплектованностью
const MIN_HEADCOUNT_SAMPLES = 2; // меньше — типичный headcount по дню недели ещё не устоялся
const NETWORK_WIDE_MIN_STORES = 3; // меньше точек в выборке — "сетевой" вывод ненадёжен
const NETWORK_WIDE_FRACTION = 0.4; // доля точек с mild-просадкой в тот же день, чтобы считать её сетевой
const NETWORK_MILD_Z = -1; // порог "просела" для сетевого сравнения — мягче Z_THRESHOLD, иначе выборка почти всегда слишком мала

export interface PossibleCause {
  type: 'understaffing' | 'shift_gap' | 'network_wide';
  detail: string;
}

export async function checkAnomalyVsForecast() {
  const today = todayMoscow();
  const yesterdayDate = new Date(today + 'T12:00:00');
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  const yesterdayDow = yesterdayDate.getDay();

  const stores = await storesRepo.listAllActive();
  if (!stores.length) return { checked: 0, created: 0 };
  const storeIds = stores.map((s) => s.id);

  // История ДО вчера (вчера намеренно исключён — иначе день сравнивается сам с собой).
  const hist = await salesRepo.findHistoricalTotals(storeIds, yesterday);

  const histByStore = new Map<string, Map<string, number>>();
  for (const r of hist) {
    const d = String(r.d).slice(0, 10);
    if (!histByStore.has(r.store_id)) histByStore.set(r.store_id, new Map());
    histByStore.get(r.store_id)!.set(d, num(r.total));
  }

  const actualRows = await salesRepo.findTotalsForDate(storeIds, yesterday);
  const actualByStore = new Map<string, number>();
  for (const r of actualRows) actualByStore.set(r.store_id, num(r.total));

  // Explain — то же самое окно и тот же батч-принцип, что sales выше, для
  // трёх факторов: недоукомплектованность (headcount из графика), разрыв
  // явки (график vs реально открытые смены), сетевая просадка (нужны z ВСЕХ
  // точек за вчера, поэтому z считаем в первом проходе, причины — во втором).
  const headcountHist = await schedulesRepo.findHeadcountHistory(storeIds, yesterday);
  const headcountHistByStore = new Map<string, Map<string, number>>();
  for (const r of headcountHist) {
    if (!headcountHistByStore.has(r.store_id)) headcountHistByStore.set(r.store_id, new Map());
    headcountHistByStore.get(r.store_id)!.set(String(r.d).slice(0, 10), num(r.headcount));
  }
  const headcountTodayRows = await schedulesRepo.findHeadcountForDate(storeIds, yesterday);
  const headcountTodayByStore = new Map<string, number>();
  for (const r of headcountTodayRows) headcountTodayByStore.set(r.store_id, num(r.headcount));
  const sessionRows = await shiftsRepo.findSessionCountForDate(storeIds, yesterday);
  const sessionsByStore = new Map<string, number>();
  for (const r of sessionRows) sessionsByStore.set(r.store_id, num(r.opened));

  // Первый проход — z каждой точки за вчера, без фильтра по порогу, чисто
  // для сетевого сравнения ниже (сколько точек ЗАОДНО просели в тот же день).
  const zByStore = new Map<string, number>();
  for (const st of stores) {
    const byDate = histByStore.get(st.id);
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
    if ((realCountByDow[yesterdayDow] || 0) < MIN_REAL_SAMPLES) continue;
    const model = buildSesModel(rows);
    const expected = projectDay(model, yesterdayDow);
    const actual = actualByStore.get(st.id) || 0;
    const spreadAbs = Math.max(model.level * model.spread[yesterdayDow], model.level * 0.2);
    if (spreadAbs <= 0) continue;
    zByStore.set(st.id, (actual - expected) / spreadAbs);
  }
  const zValues = [...zByStore.values()];
  const mildDipCount = zValues.filter((z) => z <= NETWORK_MILD_Z).length;
  const isNetworkWideDay =
    zValues.length >= NETWORK_WIDE_MIN_STORES && mildDipCount / zValues.length >= NETWORK_WIDE_FRACTION;

  let created = 0;
  for (const st of stores) {
    const z = zByStore.get(st.id);
    if (z === undefined || Math.abs(z) < Z_THRESHOLD) continue;

    const expected = projectDay(buildSesModel(rowsFor(st.id)), yesterdayDow);
    const actual = actualByStore.get(st.id) || 0;

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

    const causes: PossibleCause[] = isDip
      ? explainDip(st.id, headcountHistByStore, headcountTodayByStore, sessionsByStore, yesterdayDow, isNetworkWideDay, mildDipCount, zValues.length)
      : [];
    // payload.possible_causes хранит структуру для будущего использования
    // (аналитика, ML), но пользователь смотрит только body — фронтенд
    // (17-alerts.js) рендерит его как есть, без разбора payload, так что
    // причины дублируем читаемым текстом прямо в body, иначе они никому не видны.
    const bodyWithCauses = causes.length
      ? `${body} Возможные причины: ${causes.map((c) => c.detail).join('; ')}.`
      : body;

    const alert = await insertAlertOnce({
      store_id: st.id,
      alert_type: 'anomaly_vs_forecast',
      severity,
      title,
      body: bodyWithCauses,
      payload: {
        expected: Math.round(expected), actual, z: Number(z.toFixed(2)), dow: yesterdayDow, date: yesterday,
        possible_causes: causes
      },
      alert_date: yesterday
    });
    if (alert) created++;
  }

  return { checked: stores.length, created };

  /** Тот же 120-дневный гап-филл, что в первом проходе — нужен здесь только
   * для итогового expected в тексте алерта, уже прошедших порог точек мало,
   * пересчёт для них не проблема по стоимости. */
  function rowsFor(storeId: string): { dow: number; value: number }[] {
    const byDate = histByStore.get(storeId);
    const rows: { dow: number; value: number }[] = [];
    const cursor = new Date(yesterday + 'T12:00:00');
    cursor.setDate(cursor.getDate() - 120);
    const end = new Date(yesterday + 'T12:00:00');
    while (cursor < end) {
      const key = cursor.toISOString().slice(0, 10);
      rows.push({ dow: cursor.getDay(), value: byDate?.has(key) ? byDate!.get(key)! : 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return rows;
  }
}

export function explainDip(
  storeId: string,
  headcountHistByStore: Map<string, Map<string, number>>,
  headcountTodayByStore: Map<string, number>,
  sessionsByStore: Map<string, number>,
  dow: number,
  isNetworkWideDay: boolean,
  mildDipCount: number,
  totalStoresWithZ: number
): PossibleCause[] {
  const causes: PossibleCause[] = [];

  const hist = headcountHistByStore.get(storeId);
  if (hist) {
    let sum = 0;
    let count = 0;
    for (const [dateStr, headcount] of hist) {
      if (new Date(dateStr + 'T12:00:00').getDay() === dow) {
        sum += headcount;
        count++;
      }
    }
    if (count >= MIN_HEADCOUNT_SAMPLES) {
      const typical = sum / count;
      const actualHeadcount = headcountTodayByStore.get(storeId) || 0;
      if (typical > 0 && actualHeadcount < typical * UNDERSTAFF_RATIO) {
        causes.push({
          type: 'understaffing',
          detail: `по графику ${actualHeadcount} чел. против обычных ~${typical.toFixed(1)} для этого дня недели`
        });
      }
    }
  }

  const scheduled = headcountTodayByStore.get(storeId) || 0;
  const opened = sessionsByStore.get(storeId) || 0;
  if (scheduled > 0 && opened < scheduled) {
    causes.push({
      type: 'shift_gap',
      detail: `по графику ${scheduled} чел., смену реально открыли ${opened} — ${scheduled - opened} не вышли`
    });
  }

  if (isNetworkWideDay) {
    causes.push({
      type: 'network_wide',
      detail: `в этот день просело ещё ${mildDipCount - 1} из ${totalStoresWithZ} точек сети — возможно, не локальная причина`
    });
  }

  return causes;
}
