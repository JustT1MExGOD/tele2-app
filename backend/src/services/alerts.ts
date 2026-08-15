/**
 * Умные алерты по точкам — не спам в общий чат, а точечные события.
 */
import { query } from '../db/index.js';
import { todayMoscow } from '../utils/date.js';
import { notifyAdmin, notifyChat } from '../bot/index.js';
import { checkAnomalyVsForecast } from './anomaly.js';

function num(v: any) {
  return Number(v) || 0;
}

export async function runSmartAlertsTick() {
  const today = todayMoscow();
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      hour12: false
    }).format(new Date())
  );

  // только в рабочие часы
  if (hour < 11 || hour > 21) return { skipped: true, hour };

  // Раз в день, на первом тике окна — сравнение вчерашнего завершённого
  // дня с прогнозом (19.2, Anomaly Detection). Отдельная выборка точек
  // внутри checkAnomalyVsForecast — не завязана на общий stores.rows ниже.
  if (hour === 11) {
    await checkAnomalyVsForecast().catch((e) => console.error('checkAnomalyVsForecast:', e?.message || e));
  }

  const stores = await query(
    `SELECT id, name, code FROM stores WHERE COALESCE(is_active,true)=true`
  );

  const created: any[] = [];

  for (const st of stores.rows) {
    const sales = await query(
      `SELECT COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp,
              COALESCE(SUM(pa),0) pa, COALESCE(SUM(combo),0) combo
       FROM sales WHERE store_id = $1 AND sale_date::date = $2::date`,
      [st.id, today]
    );
    const s = sales.rows[0] || {};
    const sim = num(s.sim);
    const mnp = num(s.mnp);

    // 0 MNP при уже заметных SIM после 14:00
    if (hour >= 14 && sim >= 4 && mnp === 0) {
      const alert = await insertAlertOnce({
        store_id: st.id,
        alert_type: 'low_mnp_ratio',
        severity: 'warn',
        title: `${st.name}: 0 MNP при ${sim} SIM`,
        body: `К ${hour}:00 на точке ${sim} SIM и ни одного MNP — нетипично. Проверьте скрипт переноса.`,
        payload: { sim, mnp, hour, date: today }
      });
      if (alert) created.push(alert);
    }

    // нет продаж к 13:00 при открытой смене
    if (hour >= 13 && sim + mnp + num(s.pa) === 0) {
      const open = await query(
        `SELECT COUNT(*)::int c FROM shift_sessions
         WHERE store_id = $1 AND work_date = $2::date AND status = 'open'`,
        [st.id, today]
      );
      if (num(open.rows[0]?.c) > 0) {
        const alert = await insertAlertOnce({
          store_id: st.id,
          alert_type: 'no_sales_hour',
          severity: 'critical',
          title: `${st.name}: тишина до ${hour}:00`,
          body: `Смена открыта, продаж нет. Загляни на точку или напиши смене.`,
          payload: { hour, date: today }
        });
        if (alert) created.push(alert);
      }
    }

    // кассовый разрыв
    const cash = await query(
      `SELECT cash_fact, cash_1c FROM store_cash
       WHERE store_id = $1 AND cash_date = $2::date`,
      [st.id, today]
    );
    if (cash.rows[0]) {
      const delta = num(cash.rows[0].cash_fact) - num(cash.rows[0].cash_1c);
      if (Math.abs(delta) >= 1000) {
        const alert = await insertAlertOnce({
          store_id: st.id,
          alert_type: 'cash_gap',
          severity: Math.abs(delta) >= 5000 ? 'critical' : 'warn',
          title: `${st.name}: расхождение кассы ${delta}`,
          body: `Факт ${cash.rows[0].cash_fact} vs 1С ${cash.rows[0].cash_1c}`,
          payload: { delta, date: today }
        });
        if (alert) created.push(alert);
      }
    }
  }

  // уведомить admin о critical
  for (const a of created) {
    if (a.severity === 'critical') {
      await notifyAdmin(`🚨 <b>${a.title}</b>\n${a.body || ''}`);
    }
  }

  return { hour, created: created.length, items: created };
}

export async function insertAlertOnce(opts: {
  store_id: string;
  employee_id?: number;
  alert_type: string;
  severity: string;
  title: string;
  body: string;
  payload: any;
  /** По умолчанию сегодня — детекция аномалий (19.2) проверяет ВЧЕРАШНИЙ
   * завершённый день и должна клеймиться под его датой, не под сегодняшней. */
  alert_date?: string;
}) {
  // Атомарный claim по partial unique index (store_id, alert_type,
  // alert_date) WHERE status='open' (0007) — раньше это была
  // SELECT-проверка и отдельный INSERT, уязвимые к гонке между двумя
  // одновременно живыми контейнерами при деплое (см. миграцию). ON
  // CONFLICT DO NOTHING делает второй, проигравший вызов молча no-op.
  const res = await query(
    `INSERT INTO smart_alerts (store_id, employee_id, alert_type, severity, title, body, payload, alert_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      opts.store_id,
      opts.employee_id || null,
      opts.alert_type,
      opts.severity,
      opts.title,
      opts.body,
      JSON.stringify(opts.payload || {}),
      opts.alert_date || todayMoscow()
    ]
  );
  return res.rows[0] || null;
}
