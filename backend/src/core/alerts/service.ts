/**
 * Умные алерты по точкам — не спам в общий чат, а точечные события.
 * 20.8.0 (Full DAL): SQL переехал в repositories/alerts.ts + stores.ts +
 * sales.ts + shifts.ts + cash.ts, этот файл остаётся генератором (бизнес-
 * правила "что считать алертом"), композирующим их вызовы.
 */
import { todayMoscow } from '../../utils/date.js';
import { notifyAdmin, notifyChat } from '../../integrations/telegram/bot.js';
import { checkAnomalyVsForecast } from '../analytics/anomaly.js';
import * as alertsRepo from '../../data/repositories/alerts.js';
import * as storesRepo from '../../data/repositories/stores.js';
import * as salesRepo from '../../data/repositories/sales.js';
import * as shiftsRepo from '../../data/repositories/shifts.js';
import * as cashRepo from '../../data/repositories/cash.js';

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

  const stores = await storesRepo.listAllActive();

  const created: any[] = [];

  for (const st of stores) {
    const s = await salesRepo.sumMetricsForStoreDay(st.id, today);
    const sim = num(s.sim);
    const mnp = num(s.mnp);

    // 0 MNP при уже заметных SIM после 14:00
    if (hour >= 14 && sim >= 4 && mnp === 0) {
      const alert = await alertsRepo.insertOnce({
        store_id: st.id,
        alert_type: 'low_mnp_ratio',
        severity: 'warn',
        title: `${st.name}: 0 MNP при ${sim} SIM`,
        body: `К ${hour}:00 на точке ${sim} SIM и ни одного MNP — нетипично. Проверьте скрипт переноса.`,
        payload: { sim, mnp, hour, date: today },
        alert_date: today
      });
      if (alert) created.push(alert);
    }

    // нет продаж к 13:00 при открытой смене
    if (hour >= 13 && sim + mnp + num(s.pa) === 0) {
      const openCount = await shiftsRepo.countOpenForStoreDay(st.id, today);
      if (openCount > 0) {
        const alert = await alertsRepo.insertOnce({
          store_id: st.id,
          alert_type: 'no_sales_hour',
          severity: 'critical',
          title: `${st.name}: тишина до ${hour}:00`,
          body: `Смена открыта, продаж нет. Загляни на точку или напиши смене.`,
          payload: { hour, date: today },
          alert_date: today
        });
        if (alert) created.push(alert);
      }
    }

    // кассовый разрыв
    const cash = await cashRepo.findOneForStoreDay(st.id, today);
    if (cash) {
      const delta = num(cash.cash_fact) - num(cash.cash_1c);
      if (Math.abs(delta) >= 1000) {
        const alert = await alertsRepo.insertOnce({
          store_id: st.id,
          alert_type: 'cash_gap',
          severity: Math.abs(delta) >= 5000 ? 'critical' : 'warn',
          title: `${st.name}: расхождение кассы ${delta}`,
          body: `Факт ${cash.cash_fact} vs 1С ${cash.cash_1c}`,
          payload: { delta, date: today },
          alert_date: today
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

export const insertAlertOnce = alertsRepo.insertOnce;
