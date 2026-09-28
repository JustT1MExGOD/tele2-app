/**
 * Обратное направление (Phase 2) — правка графика внутри приложения
 * толкается в Google Таблицу через Sheets API v4 (сервис-аккаунт, запись).
 * Отдельная авторизация от sheets-webhook.ts (тот — таблица->сервер по
 * общему секрету; этот — сервер->таблица по сервис-аккаунту Google).
 *
 * Симметрия с sheet-schedule-import.ts (см. его файловый комментарий про
 * loop-prevention): эта функция вызывается ТОЛЬКО из app-side писателей
 * (upsert/deleteOne/bindReplacementPlaceholder/deleteFutureForEmployee/
 * deleteEditableRangeForOrgMonth/deleteByIdVersioned/correctScheduleRow),
 * никогда из upsertFromSheet/deleteOneFromSheet — иначе правка из таблицы
 * тут же уходила бы обратно в таблицу и так по кругу.
 *
 * Отключено (тихий no-op), пока не заданы оба GOOGLE_SHEETS_SA_KEY_BASE64
 * и GOOGLE_SHEETS_SPREADSHEET_ID — тот же принцип, что у SHEETS_WEBHOOK_SECRET
 * в sheets-webhook.ts (фича не активна, пока не сконфигурирована).
 */
import { google, sheets_v4 } from 'googleapis';
import * as employeesRepo from '../../data/repositories/employees.js';
import * as mappingsRepo from '../../data/repositories/sheet-schedule-import.js';
import { findRowForExport } from '../schedules/index.js';
import { findBestMatch } from './sheet-name-match.js';
import { REPLACEMENT_PLACEHOLDER_STORE_ID } from '../../shared/replacement.js';

const NAME_COLUMN = 0;       // колонка A (0-based) — та же раскладка, что обнаружена в Apps Script (docs/SHEET-SCHEDULE-IMPORT.md)
const HEADER_ROW = 7;        // строка 8 (0-based 7) — реальные даты
const FIRST_DATA_ROW = 9;    // строка 10 (0-based 9) — первый сотрудник
const FIRST_DATE_COLUMN = 3; // колонка D (0-based 3)
const BLOCK_HEIGHT = 2;      // строка смены + строка часов

const MONTH_NAMES_NOMINATIVE = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'
];

/** Тот же реверс, что COLOR_TO_STORE в Apps Script (docs/SHEET-SCHEDULE-IMPORT.md) — держать в синхроне вручную при добавлении новой точки/цвета. */
const STORE_TO_COLOR: Record<string, string> = {
  kalinina2: '#ff6d01',
  kalinina11: '#ffd966',
  kosmonavtov: '#6d9eeb',
  [REPLACEMENT_PLACEHOLDER_STORE_ID]: '#00ff00'
};

const SHEETS_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

/** YYYY-MM-DD -> серийный номер даты Google Sheets (дней с 1899-12-30) — то же представление, что возвращает Sheets API при valueRenderOption=UNFORMATTED_VALUE для ячейки с датой. */
export function workDateToSerial(workDate: string): number {
  const [y, m, d] = workDate.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - SHEETS_EPOCH_UTC_MS) / 86400000);
}

/** "2026-11-05" -> "Ноябрь 2026" — реверс формата имени листа, который парсил Apps Script до перехода на чтение дат прямо из шапки. */
export function sheetTitleForMonth(workDate: string): string {
  const [y, m] = workDate.split('-').map(Number);
  const name = MONTH_NAMES_NOMINATIVE[m - 1];
  return name.charAt(0).toUpperCase() + name.slice(1) + ' ' + y;
}

/** 0-based индекс колонки -> буква A1 (0->A, 25->Z, 26->AA, ...). */
export function colLetter(idx: number): string {
  let n = idx + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "#ff6d01" -> {red,green,blue} 0..1 — формат, который Sheets API ждёт для userEnteredFormat.backgroundColor. */
export function hexToRgb(hex: string): { red: number; green: number; blue: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

function getConfig(): { keyBase64: string; spreadsheetId: string } | null {
  const keyBase64 = process.env.GOOGLE_SHEETS_SA_KEY_BASE64;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!keyBase64 || !spreadsheetId) return null;
  return { keyBase64, spreadsheetId };
}

let cachedClient: { keyBase64: string; client: Promise<sheets_v4.Sheets> } | null = null;
function getSheetsClient(keyBase64: string): Promise<sheets_v4.Sheets> {
  if (cachedClient?.keyBase64 === keyBase64) return cachedClient.client;
  const client = (async () => {
    const credentials = JSON.parse(Buffer.from(keyBase64, 'base64').toString('utf8'));
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    return google.sheets({ version: 'v4', auth: auth as any });
  })();
  cachedClient = { keyBase64, client };
  return client;
}

async function findTab(sheets: sheets_v4.Sheets, spreadsheetId: string, title: string): Promise<{ sheetId: number } | null> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
  const match = meta.data.sheets?.find((s) => s.properties?.title === title);
  const sheetId = match?.properties?.sheetId;
  return sheetId != null ? { sheetId } : null;
}

async function findDateColumn(sheets: sheets_v4.Sheets, spreadsheetId: string, title: string, workDate: string): Promise<number | null> {
  const range = `'${title}'!${colLetter(FIRST_DATE_COLUMN)}${HEADER_ROW + 1}:${colLetter(FIRST_DATE_COLUMN + 200)}${HEADER_ROW + 1}`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' });
  const row = res.data.values?.[0] || [];
  const target = workDateToSerial(workDate);
  for (let i = 0; i < row.length; i++) {
    const v = Number(row[i]);
    if (Number.isFinite(v) && Math.round(v) === target) return FIRST_DATE_COLUMN + i;
  }
  return null;
}

interface EmployeeBlock { name: string; row: number; }

/** Одно чтение колонки A целиком (строки блоков сотрудников) — переиспользуется и для поиска нужного сотрудника, и для вычисления, куда добавить новый блок. Мёрдж на пару строк отдаёт значение только на строке блока — пустые строки в результате естественно пропускаются. */
async function readEmployeeBlocks(sheets: sheets_v4.Sheets, spreadsheetId: string, title: string): Promise<EmployeeBlock[]> {
  const range = `'${title}'!${colLetter(NAME_COLUMN)}${FIRST_DATA_ROW + 1}:${colLetter(NAME_COLUMN)}2000`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = res.data.values || [];
  const blocks: EmployeeBlock[] = [];
  for (let i = 0; i < values.length; i++) {
    const name = (values[i]?.[0] ?? '').toString().trim();
    if (name) blocks.push({ name, row: FIRST_DATA_ROW + i });
  }
  return blocks;
}

async function appendEmployeeBlock(
  sheets: sheets_v4.Sheets, spreadsheetId: string, sheetId: number, title: string, blockRow: number, employeeFullName: string
): Promise<void> {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        mergeCells: {
          range: { sheetId, startRowIndex: blockRow, endRowIndex: blockRow + BLOCK_HEIGHT, startColumnIndex: NAME_COLUMN, endColumnIndex: NAME_COLUMN + 1 },
          mergeType: 'MERGE_ALL'
        }
      }]
    }
  });
  // "2\2"/"режим"/"рабочие часы" — те же служебные подписи, что видны у существующих
  // сотрудников (docs/SHEET-SCHEDULE-IMPORT.md); лучшее приближение без знания
  // реального графика нового человека, не точная копия форматирования соседних строк.
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${title}'!${colLetter(NAME_COLUMN)}${blockRow + 1}:${colLetter(NAME_COLUMN + 2)}${blockRow + BLOCK_HEIGHT}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[employeeFullName, '2\\2', 'режим'], ['', '', 'рабочие часы']] }
  });
}

async function writeShiftCell(
  sheets: sheets_v4.Sheets, spreadsheetId: string, sheetId: number, title: string,
  blockRow: number, col: number, shiftText: string, hours: number | string, colorHex: string | undefined
): Promise<void> {
  const shiftRange = `'${title}'!${colLetter(col)}${blockRow + 1}`;
  const hoursRange = `'${title}'!${colLetter(col)}${blockRow + 2}`;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: shiftRange, values: [[shiftText]] },
        { range: hoursRange, values: [[hours]] }
      ]
    }
  });
  const rgb = colorHex ? hexToRgb(colorHex) : { red: 1, green: 1, blue: 1 };
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: { sheetId, startRowIndex: blockRow, endRowIndex: blockRow + BLOCK_HEIGHT, startColumnIndex: col, endColumnIndex: col + 1 },
          cell: { userEnteredFormat: { backgroundColor: rgb } },
          fields: 'userEnteredFormat.backgroundColor'
        }
      }]
    }
  });
}

/**
 * Единственная точка входа для всех app-side писателей графика. Сама
 * перечитывает текущее состояние schedules для (employeeId, workDate) —
 * вызывающему коду не нужно передавать shift/hours/store, только два
 * ключа, которые у него и так уже есть. Никогда не бросает исключение
 * наружу — вызывать fire-and-forget (`.catch(...)` не обязателен, но
 * лишним не будет на случай будущего изменения этого контракта).
 */
export async function pushScheduleChangeToSheet(employeeId: number, workDate: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return; // фича выключена, пока не заданы оба env var

  try {
    const employee = await employeesRepo.findAdminProfileById(employeeId);
    if (!employee) return;
    const orgId = employee.org_id ?? 'default';

    const sheets = await getSheetsClient(cfg.keyBase64);
    const title = sheetTitleForMonth(workDate);

    const tab = await findTab(sheets, cfg.spreadsheetId, title);
    if (!tab) {
      console.warn(`[sheet-export] лист "${title}" не найден в таблице — пропуск (новые месяцы листов не создаются автоматически)`);
      return;
    }

    const col = await findDateColumn(sheets, cfg.spreadsheetId, title, workDate);
    if (col == null) {
      console.warn(`[sheet-export] дата ${workDate} не найдена в строке-шапке листа "${title}"`);
      return;
    }

    const mapping = await mappingsRepo.findMappingByEmployee(orgId, employeeId);
    const searchName = mapping?.sheet_name_raw ?? employee.full_name;

    const blocks = await readEmployeeBlocks(sheets, cfg.spreadsheetId, title);
    const match = findBestMatch(searchName, blocks.map((b) => ({ id: b.row, full_name: b.name })));

    let blockRow: number;
    if (match) {
      blockRow = match.employeeId; // id здесь — номер строки (findBestMatch — generic-сопоставитель строк, не только имён сотрудников)
      if (!mapping) await mappingsRepo.createConfirmedMapping(orgId, blocks[blocks.findIndex((b) => b.row === blockRow)].name, employeeId, null);
    } else {
      const lastRow = blocks.length ? Math.max(...blocks.map((b) => b.row)) : FIRST_DATA_ROW - BLOCK_HEIGHT;
      blockRow = lastRow + BLOCK_HEIGHT;
      await appendEmployeeBlock(sheets, cfg.spreadsheetId, tab.sheetId, title, blockRow, employee.full_name);
    }

    const current = await findRowForExport(employeeId, workDate);
    const shiftText = current?.shift_text ?? '';
    const hours = current?.hours ? current.hours : '';
    const colorHex = current?.store_id ? STORE_TO_COLOR[current.store_id] : undefined;

    await writeShiftCell(sheets, cfg.spreadsheetId, tab.sheetId, title, blockRow, col, shiftText, hours, colorHex);
  } catch (e) {
    console.error(`[sheet-export] push failed for employee ${employeeId} / ${workDate}:`, (e as Error)?.message || e);
  }
}
