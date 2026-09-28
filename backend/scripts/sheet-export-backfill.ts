/**
 * Разовый backfill: копирует всё, что уже есть в `schedules` (по
 * умолчанию с 2026-09-01), в Google Таблицу — через ту же логику, что и
 * обычный живой пуш (core/integrations/sheet-schedule-export.ts), просто
 * вызванную по очереди для каждой строки, с небольшой паузой между
 * вызовами (Sheets API имеет квоту на запись в минуту).
 *
 * Упрощение относительно "один batchUpdate на весь месяц": здесь строки
 * идут по одной, как в обычном живом пуше — самое дорогое (поиск листа,
 * колонки-даты и блока сотрудника) всё равно перечитывается на каждую
 * ячейку живым пушем, так что настоящая экономия была бы только в
 * значениях/цвете (сгруппировать их в один values.batchUpdate/batchUpdate
 * на весь месяц). Для разового ручного запуска, который не бьёт по
 * production-нагрузке, это осознанно оставлено простым — если бэкафилл
 * окажется на практике слишком медленным/дорогим по квоте, тогда стоит
 * написать настоящую групповую версию, не раньше.
 *
 * Запуск: npx tsx scripts/sheet-export-backfill.ts [YYYY-MM-DD]
 * (аргумент — с какой даты начать, по умолчанию 2026-09-01).
 * Требует настроенных GOOGLE_SHEETS_SA_KEY_BASE64 / GOOGLE_SHEETS_SPREADSHEET_ID
 * (см. docs/SHEET-SCHEDULE-IMPORT.md) — без них пуш молча ничего не делает.
 */
import '../src/env.js';
import { query } from '../src/data/db/index.js';
import { pushScheduleChangeToSheet } from '../src/core/integrations/sheet-schedule-export.js';

const DELAY_MS = 400; // достаточно, чтобы не упереться в квоту записи Sheets API при разовом прогоне

async function main() {
  const fromDate = process.argv[2] || '2026-09-01';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    console.error('Использование: npx tsx scripts/sheet-export-backfill.ts [YYYY-MM-DD]');
    process.exit(1);
  }

  const res = await query(
    `SELECT employee_id, work_date FROM schedules WHERE work_date >= $1 ORDER BY work_date, employee_id`,
    [fromDate]
  );
  console.log(`Найдено ${res.rows.length} строк графика с ${fromDate}. Начинаю пуш в Google Таблицу...`);

  let done = 0;
  let failed = 0;
  for (const row of res.rows) {
    try {
      await pushScheduleChangeToSheet(row.employee_id, String(row.work_date).slice(0, 10));
      done++;
    } catch (e) {
      failed++;
      console.error(`Ошибка на employee_id=${row.employee_id} work_date=${row.work_date}:`, (e as Error)?.message || e);
    }
    if ((done + failed) % 20 === 0) console.log(`...${done + failed}/${res.rows.length}`);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`Готово: ${done} применено, ${failed} с ошибкой (см. вывод выше).`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Backfill упал:', e);
  process.exit(1);
});
