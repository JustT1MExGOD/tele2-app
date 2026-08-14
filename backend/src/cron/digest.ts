/**
 * Reports (18.9) — недельная (понедельник 09:00 МСК) и месячная (1-е число
 * 09:00 МСК) сводка по сети. Расписание тем же стилем, что smart_alerts
 * (services/alerts.ts): node-cron тикает раз в минуту, время проверяется
 * вручную через nowTimeMoscow()/todayMoscow() — без опции timezone у
 * node-cron, тот же паттерн, что уже используется в проекте.
 */
import cron from 'node-cron';
import { todayMoscow, nowTimeMoscow } from '../utils/date.js';
import { sendNetworkDigest } from '../services/network-digest.js';

export function startDigestCron() {
  cron.schedule('* * * * *', () => {
    if (nowTimeMoscow() !== '09:00') return;
    const date = todayMoscow();
    const weekday = new Date(date + 'T12:00:00').getDay(); // 0=вс, 1=пн
    if (weekday === 1) {
      sendNetworkDigest('weekly').catch((e) => console.error('weekly digest:', e?.message || e));
    }
    if (date.slice(8, 10) === '01') {
      sendNetworkDigest('monthly').catch((e) => console.error('monthly digest:', e?.message || e));
    }
  });
}
