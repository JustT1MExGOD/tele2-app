import { describe, it, expect, afterAll } from 'vitest';
import { claimReleaseAnnouncement } from '../../src/services/release-announce.js';
import { query } from '../../src/db/index.js';

// Регрессия: анонс релиза дублировался в реальный чат (18.1.0 ушёл дважды
// подряд). SELECT-проверка и UPDATE-отметка были двумя отдельными шагами
// с медленной отправкой в Telegram между ними — Railway держит старый
// контейнер живым, пока новый не пройдёт healthcheck, оба процесса на
// старте видели "ещё не анонсировано" и оба слали одно и то же в чат.
describe('claimReleaseAnnouncement — идемпотентность анонса релиза', () => {
  afterAll(async () => {
    await query(`DELETE FROM app_settings WHERE key = 'last_announced_version'`);
  });

  it('первый claim для новой версии — true', async () => {
    expect(await claimReleaseAnnouncement('99.0.0')).toBe(true);
  });

  it('повторный claim той же версии — false (уже анонсировано)', async () => {
    expect(await claimReleaseAnnouncement('99.0.0')).toBe(false);
    expect(await claimReleaseAnnouncement('99.0.0')).toBe(false);
  });

  it('два параллельных claim одной и той же версии (гонка при overlap контейнеров) — ровно один true', async () => {
    const [r1, r2] = await Promise.all([
      claimReleaseAnnouncement('99.1.0'),
      claimReleaseAnnouncement('99.1.0')
    ]);
    const trueCount = [r1, r2].filter(Boolean).length;
    expect(trueCount).toBe(1);
  });

  it('следующая версия claim\'ится заново, несмотря на предыдущий claim', async () => {
    expect(await claimReleaseAnnouncement('99.2.0')).toBe(true);
  });
});
