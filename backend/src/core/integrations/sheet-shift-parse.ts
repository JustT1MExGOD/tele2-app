/**
 * Sheet schedule import — разбор содержимого одной ячейки графика в таблице
 * (см. docs/SHEET-SCHEDULE-IMPORT.md). Формат ячеек — как в реальной
 * таблице пользователя: "10-22"/"9-21" (часы смены), "вых"/"отп"/пусто
 * (не работает в этот день).
 */
export type ParsedShift =
  | { kind: 'shift'; shiftText: string; hours: number }
  | { kind: 'off' }
  | { kind: 'unparseable' };

const SHIFT_RE = /^(\d{1,2})-(\d{1,2})$/;
const OFF_MARKERS = new Set(['вых', 'выходной', 'отп', 'отпуск', '']);

export function parseShiftCell(raw: string | null | undefined): ParsedShift {
  const text = (raw ?? '').trim().toLowerCase();
  if (OFF_MARKERS.has(text)) return { kind: 'off' };

  const m = SHIFT_RE.exec(text);
  if (!m) return { kind: 'unparseable' };
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start < 0 || start > 23 || end < 0 || end > 23 || start === end) return { kind: 'unparseable' };
  // ночная смена через полночь (напр. "22-6") — редкость для розницы, но не запрещаем.
  const hours = end > start ? end - start : end + 24 - start;
  if (hours <= 0 || hours >= 24) return { kind: 'unparseable' };
  return { kind: 'shift', shiftText: (raw ?? '').trim(), hours };
}
