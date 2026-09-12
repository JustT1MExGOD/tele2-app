/**
 * T2 Academy — employee course, Final Challenge "Первая самостоятельная смена".
 * Combines skills from Chapters 1-2 into one CHALLENGE step with no
 * per-item pointer — the checklist labels state the GOAL, not the how
 * (spec §12: "verify the user actually learned the workflow" rather than
 * walk them through it again step by step). All sandboxed — see
 * practiceKind: 'checklist' in ui/shared/session.ts.
 */
import type { AcademyChapter } from '../../model/types.js';

export const EMPLOYEE_FINAL_CHAPTER_ID = 'employee-final';

export const finalChapter: AcademyChapter = {
  id: EMPLOYEE_FINAL_CHAPTER_ID,
  title: 'Финальный вызов · Первая самостоятельная смена',
  subtitle: 'Без подсказок — ты справишься',
  steps: [
    {
      id: 'employee-final-intro',
      kind: 'story',
      cue: 'surprised',
      say: 'Финальная проверка! Никаких стрелочек и подсказок — просто пройди полный цикл смены, как ты уже умеешь.'
    },
    {
      id: 'employee-final-challenge',
      kind: 'challenge',
      cue: 'waiting',
      say: 'Выполни всё по порядку — это твой обычный рабочий день.',
      practiceKind: 'checklist',
      checklist: [
        { id: 'open', label: 'Открой смену', kind: 'shift-open' },
        { id: 'sale', label: 'Внеси продажу: 1 SIM', kind: 'sale' },
        { id: 'close', label: 'Закрой смену', kind: 'shift-close' }
      ]
    },
    {
      id: 'employee-final-complete',
      kind: 'cutscene',
      cue: 'chapter-complete',
      say: 'Ты прошёл весь курс T2 Academy! Теперь ты по-настоящему готов к работе в T2 Sales.'
    }
  ]
};
