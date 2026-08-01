/**
 * Быстрый разбор фразы в метрики продаж.
 * Примеры:
 *  "две симки и одно mnp"
 *  "3 sim 1 па 2 комбо"
 *  "сим 2, аксы 1500"
 */

const WORD_NUM: Record<string, number> = {
  ноль: 0, один: 1, одна: 1, одно: 1, два: 2, две: 2, три: 3,
  четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10
};

const METRIC_ALIASES: Record<string, string[]> = {
  sim: ['sim', 'сим', 'симк', 'симки', 'симок', 'симу', 'симки'],
  mnp: ['mnp', 'мнп', 'перенос', 'портир'],
  pa: ['pa', 'па', 'золот', 'gold'],
  combo: ['combo', 'комбо', 'комб'],
  phones: ['phone', 'телефон', 'смарт', 'труб'],
  accessories: ['акс', 'accessories', 'аксессуар', 'чехол', 'стек'],
  insurance: ['страх', 'insurance', 'страхов'],
  wink: ['wink', 'винк'],
  shpd: ['shpd', 'шпд', 'интернет', 'домашний'],
  focus: ['фо', 'focus', 'фокус'],
  settings: ['настрой', 'settings'],
  credit_request: ['кредит заяв', 'credit_request'],
  credit_issued: ['кредит выд', 'credit_issued'],
  plotter: ['плотт', 'plotter'],
  hb: ['hb', 'нв', 'heart']
};

function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumberToken(tok: string): number | null {
  if (/^\d+([.,]\d+)?$/.test(tok)) return Number(tok.replace(',', '.'));
  if (WORD_NUM[tok] != null) return WORD_NUM[tok];
  return null;
}

function matchMetric(token: string): string | null {
  for (const [metric, aliases] of Object.entries(METRIC_ALIASES)) {
    for (const a of aliases) {
      if (token === a || token.startsWith(a)) return metric;
    }
  }
  return null;
}

export type ParsedSale = {
  metrics: Record<string, number>;
  raw: string;
  confidence: number;
  unmatched: string[];
};

/**
 * Разбор: ищем пары число↔метрика в любом порядке рядом.
 */
export function parseSalePhrase(input: string): ParsedSale {
  const raw = String(input || '').trim();
  const text = normalize(raw);
  const tokens = text.split(' ').filter(Boolean);
  const metrics: Record<string, number> = {};
  const used = new Set<number>();
  const unmatched: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    if (used.has(i)) continue;
    const n1 = parseNumberToken(tokens[i]);
    const m1 = matchMetric(tokens[i]);

    // "2 sim" / "две симки"
    if (n1 != null && i + 1 < tokens.length) {
      const m = matchMetric(tokens[i + 1]);
      if (m) {
        metrics[m] = (metrics[m] || 0) + n1;
        used.add(i);
        used.add(i + 1);
        continue;
      }
    }
    // "sim 2" / "симки две"
    if (m1 && i + 1 < tokens.length) {
      const n = parseNumberToken(tokens[i + 1]);
      if (n != null) {
        metrics[m1] = (metrics[m1] || 0) + n;
        used.add(i);
        used.add(i + 1);
        continue;
      }
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    if (!used.has(i)) unmatched.push(tokens[i]);
  }

  const keys = Object.keys(metrics);
  const confidence = keys.length === 0 ? 0 : Math.min(1, 0.55 + keys.length * 0.15);

  return { metrics, raw, confidence, unmatched };
}
