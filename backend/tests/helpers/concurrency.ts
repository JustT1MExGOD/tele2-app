/**
 * Общий "стенд" для race-condition тестов (20.16.0) — раньше каждый файл
 * (shift-open-race, sales-double-submit-race, plans-materialize-race,
 * access-approve-reject) заново писал свой Promise.all([...]) на 2 запроса.
 * Здесь то же самое, но переиспользуемо и на N запросов, не только 2 —
 * с двумя иногда реальная гонка не воспроизводится стабильно (event loop
 * успевает быть достаточно последовательным), пять параллельных попыток
 * надёжнее вскрывают неатомарное read-then-write окно, если оно есть.
 */
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';

export async function fireConcurrent(
  app: FastifyInstance,
  requestFactory: (i: number) => InjectOptions,
  count = 5
): Promise<LightMyRequestResponse[]> {
  return Promise.all(Array.from({ length: count }, (_, i) => app.inject(requestFactory(i))));
}

/** Сколько ответов реально прошли (по умолчанию — любой 2xx) — для
 * "ровно один победитель" вместо ручного фильтра в каждом тесте. */
export function countStatus(results: LightMyRequestResponse[], codes: number[]): number {
  return results.filter((r) => codes.includes(r.statusCode)).length;
}
