import { query } from '../db/index.js';

// Groq: бесплатный API поверх открытых моделей (без карты на free-тарифе).
// Free-план: 1000 запросов/день, 100k токенов/день на llama-3.3-70b-versatile —
// с нашим объёмом (пара summary в день + до 3 комментариев к просадкам) с запасом.
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const DIP_THRESHOLD_PCT = 85;

async function callGroq(prompt: string, maxTokens: number): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      console.warn('Groq API error:', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (e: any) {
    console.warn('Groq call failed:', e?.message || e);
    return null;
  }
}

async function logAudit(opts: {
  kind: 'shift_summary' | 'dip_comment';
  employeeId?: number | null;
  storeId?: string | null;
  refDate?: string | null;
  prompt: string;
  response: string;
}) {
  await query(
    `INSERT INTO ai_audit (kind, employee_id, store_id, ref_date, prompt, response, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [opts.kind, opts.employeeId ?? null, opts.storeId ?? null, opts.refDate ?? null, opts.prompt, opts.response, MODEL]
  ).catch((e) => console.warn('ai_audit insert failed:', e?.message || e));
}

/** Итог смены сотруднику — 3-5 строк, генерируется сразу после закрытия смены. */
export async function generateShiftSummary(opts: {
  employeeId: number;
  employeeName: string;
  planPct: number;
  idealShift: boolean;
  fact: Record<string, number>;
  dayPlan: Record<string, number>;
  xpGained: number;
  leveledUp: boolean;
  streakDays: number;
}): Promise<string | null> {
  const prompt = `Ты — короткий бодрый комментатор смены продавца в сети салонов связи Т2. Напиши итог смены сотруднику: 3-5 строк, разговорным языком, без канцелярита, без markdown-заголовков и списков. Похвали конкретное, если есть за что; если план не закрыт — без нытья мягко подскажи, куда расти дальше. Обращайся на "ты".

Сотрудник: ${opts.employeeName}
План дня закрыт на ${opts.planPct}%${opts.idealShift ? ' — смена идеальная' : ''}
Факт: SIM ${opts.fact.sim || 0}, MNP ${opts.fact.mnp || 0}, ПА ${opts.fact.pa || 0}, комбо ${opts.fact.combo || 0}
План: SIM ${opts.dayPlan.sim || 0}, MNP ${opts.dayPlan.mnp || 0}, ПА ${opts.dayPlan.pa || 0}, комбо ${opts.dayPlan.combo || 0}
Получено XP за смену: ${opts.xpGained}${opts.leveledUp ? ' (новый уровень!)' : ''}
Серия дней подряд: ${opts.streakDays}`;

  const text = await callGroq(prompt, 400);
  if (text) {
    await logAudit({ kind: 'shift_summary', employeeId: opts.employeeId, prompt, response: text });
  }
  return text;
}

const GOOD_PHRASES = [
  'План закрыт — команда сегодня отработала как надо. 👏',
  'Хороший день: план выполнен, можно выдохнуть.',
  'План в норме — держите темп, всё под контролем.',
  'День закрыт по плану — отличная работа точки.',
  'Показатели в порядке, план выполнен. Так держать.'
];

const METRIC_LABELS: Record<string, string> = {
  sim: 'SIM', mnp: 'MNP', pa: 'ПА', combo: 'Комбо',
  settings: 'Настройки', accessories: 'Аксессуары', insurance: 'Страховки',
  phones: 'Телефоны', wink: 'Wink', shpd: 'ШПД', focus: 'ФО',
  credit_request: 'Кредит заявка', credit_issued: 'Кредит выдан',
  plotter: 'Плоттер', hb: 'НВ', imp: 'Импорт', import: 'Импорт', esim: 'eSIM'
};

function metricLabel(key: string): string {
  return METRIC_LABELS[key] || key;
}

/** Факт/план по всем показателям точки, у которых план > 0 (не только SIM/MNP/ПА/Комбо). */
function planBreakdown(fact: Record<string, number>, dayPlan: Record<string, number>): string {
  return Object.keys(dayPlan)
    .filter((k) => num(dayPlan[k]) > 0)
    .map((k) => `${metricLabel(k)} ${num(fact[k])}/${num(dayPlan[k])}`)
    .join(', ');
}

/**
 * Комментарий к дню точки для итогового отчёта. Если факт >= 85% от плана —
 * без вызова модели, просто заготовленная фраза-похвала. Ниже порога —
 * короткая гипотеза от модели, почему просели, на основе факта/плана дня.
 * Учитывает ВСЕ показатели точки с ненулевым планом (store_plans — 18 колонок,
 * не только SIM/MNP/ПА/Комбо), иначе просадка по, например, страховкам или
 * аксессуарам модель никогда не увидит.
 */
export async function generateDipComment(opts: {
  storeId: string;
  storeName: string;
  date: string;
  fact: Record<string, number>;
  dayPlan: Record<string, number>;
}): Promise<{ text: string; isAi: boolean; actualPct: number }> {
  const plannedKeys = Object.keys(opts.dayPlan).filter((k) => num(opts.dayPlan[k]) > 0);
  const factUnits = plannedKeys.reduce((s, k) => s + num(opts.fact[k]), 0);
  const planUnits = plannedKeys.reduce((s, k) => s + num(opts.dayPlan[k]), 0);
  const actualPct = planUnits > 0 ? Math.round((factUnits / planUnits) * 100) : 100;

  if (actualPct >= DIP_THRESHOLD_PCT) {
    return { text: GOOD_PHRASES[Math.floor(Math.random() * GOOD_PHRASES.length)], isAi: false, actualPct };
  }

  const fallback = `План дня закрыт на ${actualPct}% — есть отставание от плана.`;
  const breakdown = planBreakdown(opts.fact, opts.dayPlan);
  const prompt = `Ты — аналитик сети салонов связи Т2. По точке за день просел план продаж. Дай короткую гипотезу (1-2 предложения, без markdown, на русском), почему могло случиться отставание — обязательно опирайся на то, какие именно показатели просели сильнее остальных (не только SIM), и что стоит проверить завтра. Пиши по делу, без общих фраз вроде "нужно больше стараться".

Точка: ${opts.storeName}
Дата: ${opts.date}
План дня закрыт на ${actualPct}%
Факт/план по каждому показателю с ненулевым планом: ${breakdown}`;

  const text = await callGroq(prompt, 250);
  if (!text) return { text: fallback, isAi: false, actualPct };

  await logAudit({ kind: 'dip_comment', storeId: opts.storeId, refDate: opts.date, prompt, response: text });
  return { text, isAi: true, actualPct };
}

/** Последний AI-комментарий к просадке точки за дату (для Command Center). */
export async function getLatestDipComment(storeId: string, date: string): Promise<string | null> {
  const res = await query(
    `SELECT response FROM ai_audit
     WHERE kind = 'dip_comment' AND store_id = $1 AND ref_date = $2::date
     ORDER BY created_at DESC LIMIT 1`,
    [storeId, date]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows[0]?.response || null;
}

function num(v: any) {
  return Number(v) || 0;
}
