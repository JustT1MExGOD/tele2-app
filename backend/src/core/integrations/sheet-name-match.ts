/**
 * Sheet schedule import — сопоставление "как сотрудник записан в Google
 * Таблице" с employees.full_name. В репозитории нет ни одной существующей
 * fuzzy-утилиты (только ILIKE '%term%' у admin/search.ts) и ни pg_trgm, ни
 * npm-пакета для этого не подключено — здесь заводится минимальная своя,
 * без внешней зависимости ради одной короткой функции.
 */

/** Полное совпадение без учёта регистра/лишних пробелов/ё-е — так "Афанасьев  Аким" и "афанасьев аким" считаются одним и тем же без обращения к похожести строк. */
export function normalizeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ё/g, 'е');
}

/** Классическое расстояние Левенштейна, itemwise (без внешней библиотеки — сотрудников в сети десятки, не тысячи, квадратичная сложность не проблема). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], row[j - 1]);
    }
    prev = row;
  }
  return prev[b.length];
}

/** 1.0 = идентичны, 0.0 = совсем разные. Нормализация применяется здесь же, вызывающему коду не нужно звать normalizeName() отдельно. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length, 1);
  return 1 - levenshtein(na, nb) / maxLen;
}

export interface NameCandidate {
  id: number;
  full_name: string;
}

export interface NameMatchResult {
  employeeId: number;
  score: number;
  exact: boolean;
}

/** Ниже этого порога кандидат вообще не предлагается (слишком разные строки, чтобы это было опечаткой одного и того же имени). */
export const FUZZY_MATCH_THRESHOLD = 0.72;

/** Лучший кандидат из списка активных сотрудников сети, либо null (совсем никого похожего). exact=true только при полном совпадении после normalizeName — это единственный случай, когда маппинг можно подтвердить автоматически, без Admin Center. */
export function findBestMatch(rawName: string, candidates: NameCandidate[]): NameMatchResult | null {
  let best: NameMatchResult | null = null;
  for (const c of candidates) {
    const score = nameSimilarity(rawName, c.full_name);
    if (!best || score > best.score) {
      best = { employeeId: c.id, score, exact: score === 1 };
    }
  }
  if (!best || best.score < FUZZY_MATCH_THRESHOLD) return null;
  return best;
}
