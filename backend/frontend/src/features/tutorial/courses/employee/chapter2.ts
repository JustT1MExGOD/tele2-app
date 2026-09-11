/**
 * T2 Academy — employee course, Chapter 2 "Смена и продажи". Both
 * practice steps are sandboxed real-UI missions: shift open/close never
 * calls POST /shifts/open|close (practice/shift-practice.ts is pure local
 * state), and the sale mission opens the REAL "Добавить продажу" form in
 * dry-run mode (practice/sale-practice.ts, reusing features/add-sale's
 * own existing __tutorialDryRun guard) — never writes to the database.
 */
import type { AcademyChapter } from '../../model/types.js';

export const EMPLOYEE_CHAPTER_2_ID = 'employee-ch2';

export const chapter2: AcademyChapter = {
  id: EMPLOYEE_CHAPTER_2_ID,
  title: 'Глава 2 · Смена и продажи',
  subtitle: 'От открытия смены до первой продажи',
  steps: [
    {
      id: 'employee-ch2-intro',
      kind: 'story',
      cue: 'explaining',
      say: 'Смена — это твоё рабочее время на точке: с открытия и до закрытия все продажи считаются твоими.',
      body: 'Потренируемся открыть смену и внести продажу — по-настоящему, но в тренировочном режиме: в базу это не уйдёт.'
    },
    {
      id: 'employee-ch2-shift-open',
      kind: 'practice',
      cue: 'waiting',
      say: 'Открой тренировочную смену — нажми кнопку ниже.',
      body: 'Это тренировка: реальная смена не откроется.',
      practiceKind: 'shift-open'
    },
    {
      id: 'employee-ch2-sale',
      kind: 'practice',
      cue: 'pointing',
      say: 'Отлично, смена открыта! Теперь внеси продажу: 1 SIM и 1 MNP.',
      body: 'Откроется настоящая форма продажи — заполни её как обычно. В базу и в чат команде это не уйдёт.',
      practiceKind: 'sale',
      saleTarget: { sim: 1, mnp: 1 }
    },
    {
      id: 'employee-ch2-shift-close',
      kind: 'practice',
      cue: 'success',
      say: 'Продажа внесена! В конце дня не забывай закрывать смену — попробуй сейчас.',
      practiceKind: 'shift-close'
    },
    {
      id: 'employee-ch2-complete',
      kind: 'cutscene',
      cue: 'chapter-complete',
      say: 'Ты прошёл полный цикл смены: открыл, продал, закрыл. Именно так это работает каждый день.'
    }
  ]
};
