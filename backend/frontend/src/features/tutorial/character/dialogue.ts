import type { ArbuzichCue } from './states.js';

/** Generic reaction lines, independent of any specific step's `say` text —
 * used for hint/mistake/success micro-reactions that aren't part of a
 * step's authored narrative (e.g. "user waited too long"). */
const GENERIC_LINES: Partial<Record<ArbuzichCue, string[]>> = {
  hint: ['Нужна подсказка? Нажми на выделенный элемент.', 'Не спеши — попробуй нажать туда, где свечение.'],
  mistake: ['Почти! Попробуй ещё раз.', 'Не то — но ты близко.'],
  success: ['Именно так!', 'Отлично сделано!'],
  surprised: ['О! Неожиданно, но сработало.']
};

let lineCursor: Partial<Record<ArbuzichCue, number>> = {};

/** Rotates through the line bank for a cue rather than always the first
 * line — cheap variety without content authoring overhead. */
export function genericLine(cue: ArbuzichCue): string | null {
  const bank = GENERIC_LINES[cue];
  if (!bank || !bank.length) return null;
  const i = (lineCursor[cue] || 0) % bank.length;
  lineCursor[cue] = i + 1;
  return bank[i];
}

/** Test-only reset. */
export function __resetDialogueCursor(): void {
  lineCursor = {};
}
