/**
 * Автоанонс версии в чат. При старте сервера сверяем последнюю запись
 * CHANGELOG с app_settings.last_announced_version; если она новее — шлём
 * картинку и запоминаем версию, чтобы не повторяться.
 *
 * Раньше источником версии для анонса был package.json запущенного
 * процесса, а не сам CHANGELOG — это молча теряло анонс, если версия с
 * записью в CHANGELOG падала на деплое (билд/healthcheck), а следующий
 * пуш был хотфиксом без своей записи: currentVersion() отдавал версию
 * хотфикса, getChangelogEntry() для неё не находил ничего, функция тихо
 * выходила (см. 20.0.1 — Vite не завёлся на Node 18 в билде Railway,
 * анонс 20.0.0 из-за этого не ушёл вообще). CHANGELOG сам по себе уже
 * список "версий, достойных анонса" (хотфиксы туда и не попадают) —
 * последняя его запись и есть то, что нужно анонсировать, независимо от
 * того, какая именно версия сейчас фактически запущена.
 */
import { CHANGELOG, ChangelogEntry } from './changelog.js';
import * as appSettingsRepo from '../../data/repositories/app-settings.js';
import { buildReleaseCardPng } from '../../core/reports/image.js';
import { notifyChatPhoto } from '../../integrations/telegram/bot.js';

const CAPTION_LIMIT = 1024; // жёсткий лимит Telegram на подпись к фото

/**
 * Заголовок + все буллеты дословно, не просто "T2 Sales обновился до X" —
 * по просьбе владельца продукта подпись должна нести полное описание
 * апдейта, не отсылать читать картинку/канал отдельно. sendPhoto не
 * передаёт parse_mode (notifyChatPhoto, bot/index.ts) — подпись голый
 * текст, HTML/Markdown-разметка тут не отрендерится, поэтому без тегов.
 */
export function buildAnnounceCaption(version: string, entry: ChangelogEntry): string {
  const bulletLines = entry.bullets.map((b) => `• ${b}`);
  const full = [`🚀 T2 Sales обновился до ${version}`, '', entry.title, '', ...bulletLines].join('\n');
  if (full.length <= CAPTION_LIMIT) return full;

  // Обрезаем по границе слова, если она не слишком далеко от лимита —
  // иначе просто режем по символу. В любом случае оставляем место под "…".
  const cutAt = CAPTION_LIMIT - 1;
  let cut = full.slice(0, cutAt);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > cutAt - 40) cut = cut.slice(0, lastSpace);
  return cut.trimEnd() + '…';
}

/**
 * true — версия claim'нута этим вызовом (можно отправлять), false — уже
 * была отмечена анонсированной (этим же или другим процессом), отправлять
 * не нужно. Claim атомарный и происходит ДО отправки, не после — раньше
 * это были SELECT-проверка и UPDATE-отметка двумя отдельными шагами с
 * медленной отправкой в Telegram (сборка PNG + сетевой запрос) между ними:
 * Railway держит старый контейнер живым, пока новый не пройдёт healthcheck
 * (17.5.1), и оба процесса на старте видели "ещё не анонсировано", оба
 * слали одно и то же в чат (тот же класс гонки, что чинили для
 * cron-отчётов в 17.16.0). WHERE ... IS DISTINCT FROM делает UPDATE
 * условным — если строка уже на этой версии, DO UPDATE не срабатывает и
 * RETURNING не отдаёт строку, ровно как offline_sync_log/cron_send_log.
 */
export async function claimReleaseAnnouncement(version: string): Promise<boolean> {
  return appSettingsRepo.claimIfChanged('last_announced_version', version);
}

export async function announceReleaseIfNeeded() {
  const entry = CHANGELOG[CHANGELOG.length - 1];
  if (!entry) return;
  const version = entry.version;

  try {
    if (!(await claimReleaseAnnouncement(version))) return;

    const { png } = await buildReleaseCardPng(entry);
    const caption = buildAnnounceCaption(version, entry);
    const filename = `release_${version}.png`;

    // Анонсы версий уходят только в выделенный Telegram-канал, не в общий
    // рабочий чат сети — явный выбор (раньше шло туда же, куда продажи/
    // алерты/отчёты, через глобальный CHAT_ID-фолбэк notifyChatPhoto).
    const channelId = process.env.RELEASE_CHANNEL_ID;
    if (!channelId) {
      console.warn('announceReleaseIfNeeded: RELEASE_CHANNEL_ID не задан, анонс пропущен (версия уже помечена анонсированной)');
      return;
    }
    const sent = await notifyChatPhoto(png, { caption, filename, chatId: channelId });
    // Claim уже сделан выше (до отправки) — версия отмечена анонсированной
    // независимо от исхода отправки. Сбой отправки здесь — не более чем
    // один пропущенный анонс (не критично для бизнеса), и это безопаснее,
    // чем повторный спам при каждом перезапуске контейнера.
    if (sent.ok) {
      console.log(`📣 Анонс версии ${version} отправлен в канал`);
    } else {
      console.warn('announceReleaseIfNeeded: отправка не удалась', sent.error, '(уже помечено анонсированным, повтора не будет)');
    }
  } catch (e: any) {
    console.error('announceReleaseIfNeeded failed:', e?.message || e);
  }
}
