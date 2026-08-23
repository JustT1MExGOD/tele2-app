import { describe, it, expect, afterAll } from 'vitest';
import { claimReleaseAnnouncement, buildAnnounceCaption } from '../../src/platform/notifications/release-announce.js';
import { query } from '../../src/data/db/index.js';

// Подпись к анонсу теперь несёт полное описание (заголовок + все буллеты),
// не короткую строку "T2 Sales обновился до X" — по прямому запросу
// владельца продукта. Telegram режет подпись к фото на 1024 символах на
// своей стороне посреди слова — buildAnnounceCaption должен обрезать сам,
// аккуратнее, заранее.
describe('buildAnnounceCaption — подпись к анонсу', () => {
  it('короткая запись — заголовок + все буллеты целиком, без обрезки', () => {
    const caption = buildAnnounceCaption('19.9.0', {
      version: '19.9.0',
      title: 'Тестовый релиз',
      bullets: ['Первый пункт', 'Второй пункт']
    });
    expect(caption).toContain('🚀 T2 Sales обновился до 19.9.0');
    expect(caption).toContain('Тестовый релиз');
    expect(caption).toContain('• Первый пункт');
    expect(caption).toContain('• Второй пункт');
    expect(caption.length).toBeLessThanOrEqual(1024);
  });

  it('длинная запись — обрезается до 1024 символов с многоточием, не посреди слова', () => {
    const longBullet = 'Слово '.repeat(300); // заведомо длиннее лимита
    const caption = buildAnnounceCaption('19.9.0', {
      version: '19.9.0',
      title: 'Большой релиз',
      bullets: [longBullet]
    });
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption.endsWith('…')).toBe(true);
    // не обрывает слово на середине — предпоследний символ (перед "…") не часть "Слово"
    expect(caption.slice(0, -1).endsWith(' ')).toBe(false); // trimEnd убрал хвостовой пробел
  });

  it('без буллетов — заголовок + title, без пустых лишних пунктов', () => {
    const caption = buildAnnounceCaption('19.9.0', { version: '19.9.0', title: 'Без буллетов', bullets: [] });
    expect(caption).toBe('🚀 T2 Sales обновился до 19.9.0\n\nБез буллетов\n');
  });
});

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
