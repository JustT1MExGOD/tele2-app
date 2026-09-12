/**
 * T2 Academy — employee course, Chapter 1 "Старт". A light first-touch
 * introduction; Chapter 3 revisits replacement in depth (schedule vs
 * shift_session vs sale attribution vs home org) once the learner already
 * has the basic shape of the app.
 */
import type { AcademyChapter } from '../../model/types.js';

export const EMPLOYEE_CHAPTER_1_ID = 'employee-ch1';

export const chapter1: AcademyChapter = {
  id: EMPLOYEE_CHAPTER_1_ID,
  title: 'Глава 1 · Старт',
  subtitle: 'Твоя история начинается здесь',
  steps: [
    {
      id: 'employee-ch1-welcome',
      kind: 'cutscene',
      cue: 'enter',
      say: 'Привет! Я Арбузыч — твой проводник в T2 Sales. Покажу, как тут всё устроено.'
    },
    {
      id: 'employee-ch1-story',
      kind: 'story',
      cue: 'explaining',
      say: 'Каждый день ты открываешь смену на своей точке, вносишь продажи и следишь за планом. Но иногда точка может быть не своя — об этом дальше.',
      body: 'T2 Sales — это твой рабочий день: план, факт, смена и точка, на которой ты сегодня работаешь.'
    },
    {
      id: 'employee-ch1-discover-store',
      kind: 'discover',
      cue: 'pointing',
      say: 'Вот твоя точка — здесь всегда видно, где ты сегодня работаешь.',
      body: 'Найди карточку точки на главном экране.',
      targetId: 'academy-store-card'
    },
    {
      id: 'employee-ch1-practice-replacement',
      kind: 'practice',
      cue: 'thinking',
      say: 'Бывает, что нужно выйти на замену — поработать на другой точке. Введи тренировочный код точки — покажу, как это работает.',
      body: 'Код для тренировки: 888967',
      targetId: 'academy-change-store-btn',
      practiceKind: 'replacement'
    },
    {
      id: 'employee-ch1-complete',
      kind: 'cutscene',
      cue: 'chapter-complete',
      say: 'Отлично! Ты нашёл свою точку и попробовал выбрать магазин для замены. Идём дальше?'
    }
  ]
};
