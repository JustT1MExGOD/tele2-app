/**
 * T2 Academy — employee course, Chapter 5 "Ещё возможности". Closes gaps
 * found by the Phase 2 coverage audit: Быстрый ввод, История продаж,
 * Месячный план, Промокоды, Объявления, офлайн-очередь were entirely
 * absent from chapters 1-4.
 *
 * Три раздела получают настоящий DISCOVER (реальный прожектор на
 * элементе): «Планы и факт за месяц», «Промокоды РТК», «Объявления» — у
 * всех есть постоянная точка входа прямо на главном экране, куда
 * startAcademy() уже переключает перед началом главы (academy-entry.ts).
 * Быстрый ввод и История продаж живут только на странице «Профиль», а
 * оверлей Academy не даёт переключать страницы внутри главы (вся
 * навигация под ним заблокирована сплошным scrim) — прожектор на них дал
 * бы битую подсветку нулевого размера. Честнее раскрыть их STORY-шагом
 * (объяснить, что это и где искать по названию), чем притворяться
 * DISCOVER-ом, которого на самом деле не будет. Офлайн-очередь по той же
 * причине не спотлайтится — её кнопка скрыта, пока очередь пуста.
 */
import type { AcademyChapter } from '../../model/types.js';

export const EMPLOYEE_CHAPTER_5_ID = 'employee-ch5';

export const chapter5: AcademyChapter = {
  id: EMPLOYEE_CHAPTER_5_ID,
  title: 'Глава 5 · Ещё возможности',
  subtitle: 'Реже нужные, но полезные разделы',
  steps: [
    {
      id: 'employee-ch5-intro',
      kind: 'story',
      cue: 'explaining',
      say: 'Осталось несколько разделов, которые нужны не каждый день, но выручают в нужный момент.'
    },
    {
      id: 'employee-ch5-story-quicksale',
      kind: 'story',
      cue: 'talking',
      say: 'Быстрый ввод — способ внести продажу одной фразой, например «две симки mnp», без открытия полной формы. Ищи его в «Профиль → Действия».'
    },
    {
      id: 'employee-ch5-story-history',
      kind: 'story',
      cue: 'talking',
      say: 'История продаж показывает все твои прошлые продажи. Тоже открывается из «Профиль → Действия».'
    },
    {
      id: 'employee-ch5-discover-monthplan',
      kind: 'discover',
      cue: 'pointing',
      say: 'А вот план и факт за месяц по всей сети — сколько кто продал и сколько осталось до цели.',
      body: 'Найди «Планы и факт за месяц» в «Быстрых действиях».',
      targetId: 'academy-month-plan-entry'
    },
    {
      id: 'employee-ch5-discover-promo',
      kind: 'discover',
      cue: 'pointing',
      say: 'Промокоды РТК — общий пул кодов на всю сеть. Код скрыт, пока не откроешь карточку.',
      body: 'Найди «Промокоды РТК» в «Инструментах».',
      targetId: 'academy-promo-entry'
    },
    {
      id: 'employee-ch5-discover-announce',
      kind: 'discover',
      cue: 'pointing',
      say: 'Объявления сети — важные новости от руководства. Некоторые нужно обязательно отметить прочитанными.',
      body: 'Найди «Объявления» в «Инструментах».',
      targetId: 'academy-announce-entry'
    },
    {
      id: 'employee-ch5-story-offline',
      kind: 'story',
      cue: 'thinking',
      say: 'Если продажа не отправилась из-за плохой связи, приложение не потеряет её — сохранит и допришлёт сама, как только связь появится. Внизу экрана появится кнопка «Не отправлено: N» — это она.'
    },
    {
      id: 'employee-ch5-complete',
      kind: 'cutscene',
      cue: 'chapter-complete',
      say: 'Теперь ты знаешь весь набор инструментов целиком, не только основные.'
    }
  ]
};
