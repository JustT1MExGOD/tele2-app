/** Смена и продажи в локальном учебном магазине. */
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
      body: 'Потренируемся открыть смену и внести продажу — в учебном магазине. Рабочие данные останутся прежними.'
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
      body: 'Открой учебную кассу и укажи 1 SIM и 1 MNP. Учебная продажа не попадёт в рабочие отчёты.',
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
