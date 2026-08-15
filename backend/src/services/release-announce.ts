/**
 * Автоанонс версии в чат. При старте сервера сверяем package.json с
 * app_settings.last_announced_version; если это новая версия и для неё
 * есть запись в CHANGELOG (см. changelog.ts — там только minor-эпики,
 * не хотфиксы), шлём картинку и запоминаем версию, чтобы не повторяться.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db/index.js';
import { getChangelogEntry, ChangelogEntry } from '../changelog.js';
import { buildReleaseCardPng } from './report-image.js';
import { notifyChatPhoto } from '../bot/index.js';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function currentVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
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
  const claim = await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('last_announced_version', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     WHERE app_settings.value IS DISTINCT FROM EXCLUDED.value
     RETURNING value`,
    [version]
  );
  return !!claim.rows[0];
}

export async function announceReleaseIfNeeded() {
  const version = currentVersion();
  const entry = getChangelogEntry(version);
  if (!entry) return; // хотфикс или версия без записи в CHANGELOG — тихо

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
