/**
 * T2 Academy — employee course, Chapter 3 "План, график и замена". The
 * deep replacement-shift lesson (spec §9): explicitly teaches
 * schedule=plan / shift_session=actual work / sale.store=actual store /
 * employee.org_id=home membership, then re-runs the sandboxed replacement
 * practice with that context already established (Chapter 1 only gave a
 * light first-touch version of the same mechanic).
 */
import type { AcademyChapter } from '../../model/types.js';

export const EMPLOYEE_CHAPTER_3_ID = 'employee-ch3';

export const chapter3: AcademyChapter = {
  id: EMPLOYEE_CHAPTER_3_ID,
  title: 'Глава 3 · План, график и замена',
  subtitle: 'План — не то же самое, что факт',
  steps: [
    {
      id: 'employee-ch3-intro',
      kind: 'story',
      cue: 'explaining',
      say: 'У каждого дня есть план — сколько нужно продать. Прогресс за день ты видишь прямо на главном экране.'
    },
    {
      id: 'employee-ch3-discover-progress',
      kind: 'discover',
      cue: 'pointing',
      say: 'Вот он — прогресс дня: факт против плана по каждой метрике.',
      body: 'Найди блок с прогрессом на главном экране.',
      targetId: 'academy-daily-progress'
    },
    {
      id: 'employee-ch3-discover-schedule',
      kind: 'discover',
      cue: 'pointing',
      say: 'А здесь — твой график на месяц: кто где и когда работает по плану.',
      body: 'Открой раздел «График».',
      targetId: 'academy-nav-schedule'
    },
    {
      id: 'employee-ch3-story-replacement',
      kind: 'story',
      cue: 'thinking',
      say: 'Важно: график — это ПЛАН, а не факт. Когда ты выходишь на замену, график остаётся прежним, а реальная смена и продажи фиксируются на той точке, где ты работаешь на самом деле.',
      body: 'План (график) ≠ факт (смена). Продажа всегда считается на ту точку, где открыта смена — даже если это чужая сеть. Твоя домашняя сеть при этом не меняется.'
    },
    {
      id: 'employee-ch3-practice-replacement',
      kind: 'practice',
      cue: 'waiting',
      say: 'Проверим на практике: введи тренировочный код точки замены ещё раз.',
      body: 'Код для тренировки: 888967',
      targetId: 'academy-change-store-btn',
      practiceKind: 'replacement'
    },
    {
      id: 'employee-ch3-quiz',
      kind: 'quiz',
      cue: 'thinking',
      say: 'Проверим себя: если ты по графику должен быть на точке А, но вышел на замену на точку Б и там продал — на какую точку засчитается продажа?',
      quiz: {
        question: 'Продажа во время замены засчитывается на...',
        options: ['Точку А (по графику)', 'Точку Б (где реально открыта смена)', 'Обе точки поровну'],
        correctIndex: 1
      }
    },
    {
      id: 'employee-ch3-complete',
      kind: 'cutscene',
      cue: 'chapter-complete',
      say: 'Именно так! План — это ориентир, а факт всегда там, где ты реально работаешь.'
    }
  ]
};
