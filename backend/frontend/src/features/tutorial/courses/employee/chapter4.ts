/**
 * T2 Academy — employee course, Chapter 4 "Инструменты и поддержка".
 * Pure DISCOVER tour of the remaining employee-reachable capabilities
 * (BFQ, Задачи, Чат, Профиль) — no sandboxed writes needed here, these
 * are read-oriented screens.
 */
import type { AcademyChapter } from '../../model/types.js';

export const EMPLOYEE_CHAPTER_4_ID = 'employee-ch4';

export const chapter4: AcademyChapter = {
  id: EMPLOYEE_CHAPTER_4_ID,
  title: 'Глава 4 · Инструменты и поддержка',
  subtitle: 'Всё остальное, что пригодится',
  steps: [
    {
      id: 'employee-ch4-intro',
      kind: 'story',
      cue: 'explaining',
      say: 'Кроме смен и продаж, в приложении есть ещё несколько полезных разделов. Пробежимся по ним.'
    },
    {
      id: 'employee-ch4-discover-bfq',
      kind: 'discover',
      cue: 'pointing',
      say: 'BFQ — короткая анкета по качеству обслуживания. Заполняется периодически.',
      body: 'Найди «BFQ» в разделе «Инструменты».',
      targetId: 'academy-bfq-entry'
    },
    {
      id: 'employee-ch4-discover-tasks',
      kind: 'discover',
      cue: 'pointing',
      say: 'Задачи — то, что назначил тебе руководитель. Не забывай проверять.',
      body: 'Открой раздел «Задачи».',
      targetId: 'academy-nav-tasks'
    },
    {
      id: 'employee-ch4-discover-chat',
      kind: 'discover',
      cue: 'pointing',
      say: 'Чат — общение со всей сетью: объявления, вопросы, поддержка.',
      body: 'Открой «Чат».',
      targetId: 'academy-nav-chat'
    },
    {
      id: 'employee-ch4-discover-profile',
      kind: 'discover',
      cue: 'pointing',
      say: 'А здесь — твой профиль: уровень, значки, месячный план и настройки.',
      body: 'Открой «Профиль».',
      targetId: 'academy-nav-my'
    },
    {
      id: 'employee-ch4-complete',
      kind: 'cutscene',
      cue: 'chapter-complete',
      say: 'Теперь ты знаешь весь набор инструментов. Осталось проверить себя целиком.'
    }
  ]
};
