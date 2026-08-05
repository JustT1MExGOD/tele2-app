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
import { getChangelogEntry } from '../changelog.js';
import { buildReleaseCardPng } from './report-image.js';
import { notifyChatPhoto } from '../bot/index.js';
import { listOrgsWithChat } from './tenant.js';

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

export async function announceReleaseIfNeeded() {
  const version = currentVersion();
  const entry = getChangelogEntry(version);
  if (!entry) return; // хотфикс или версия без записи в CHANGELOG — тихо

  try {
    const res = await query(
      `SELECT value FROM app_settings WHERE key = 'last_announced_version'`
    );
    const last = res.rows[0]?.value;
    if (last === version) return; // уже анонсировали эту версию

    const { png } = await buildReleaseCardPng(entry);
    const caption = `🚀 T2 Sales обновился до ${version}: ${entry.title}`;
    const filename = `release_${version}.png`;

    // Анонс релиза платформенный — шлём во все сети с настроенным чатом.
    // Пока сетей с явным chat_id нет (сейчас так), notifyChatPhoto сам
    // фолбэчится на глобальный CHAT_ID — поведение не меняется.
    const orgs = await listOrgsWithChat();
    const targets = orgs.length ? orgs.map((o) => o.chat_id) : [undefined];
    let anySent = false;
    for (const chatId of targets) {
      const sent = await notifyChatPhoto(png, { caption, filename, chatId });
      if (sent.ok) anySent = true;
      else console.warn('announceReleaseIfNeeded: send failed for chat', chatId, sent.error);
    }
    if (!anySent) {
      console.warn('announceReleaseIfNeeded: no send succeeded, not marking as announced');
      return;
    }

    await query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('last_announced_version', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [version]
    );
    console.log(`📣 Анонс версии ${version} отправлен в чат`);
  } catch (e: any) {
    console.error('announceReleaseIfNeeded failed:', e?.message || e);
  }
}
