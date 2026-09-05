/**
 * Кастомная аватарка (батч 3, п.19). Railway — эфемерная ФС, S3/CDN не
 * подключены — храним байты прямо в employees.avatar_data (bytea).
 * Клиент уже присылает сжатую ~256×256 картинку (canvas-ресайз в
 * 05-my-plan.js) — лимит здесь просто страховка от чужого клиента.
 */
import { FastifyInstance } from 'fastify';
import * as employeesRepo from '../../../data/repositories/employees.js';
import { requireActive } from '../../../auth/guards.js';

const MAX_AVATAR_BYTES = 1.5 * 1024 * 1024;

/**
 * Клиентский mimetype — просто заголовок, который отправитель ставит сам
 * (легко подделать). Определяем реальный формат по magic bytes и ТОЛЬКО
 * его используем дальше (и для проверки, и для Content-Type при отдаче) —
 * declared mimetype от клиента после этой точки не используется вообще.
 * SVG намеренно не входит в список разрешённых: это XML/текст, а не растр —
 * потенциальный вектор XSS при отдаче через <img>/прямую навигацию в некоторых
 * браузерных контекстах.
 */
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'image/png';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) return 'image/webp';
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  return null;
}

export async function registerAvatarRoutes(app: FastifyInstance) {
  app.post(
    '/me/avatar',
    // 20.50.0 — write-сторона уже лимитированного read (GET /avatars/:id,
    // 30/мин) не должна быть дешевле чтения.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const data = await request.file({ limits: { fileSize: MAX_AVATAR_BYTES } }).catch(() => null);
    if (!data) {
      return reply.code(400).send({ error: 'no_file', message: 'Файл не получен' });
    }
    const buffer = await data.toBuffer().catch(() => null);
    if (!buffer || !buffer.length) {
      return reply.code(400).send({ error: 'empty_file', message: 'Пустой файл' });
    }
    if (buffer.length > MAX_AVATAR_BYTES) {
      return reply.code(413).send({ error: 'too_large', message: 'Слишком большой файл' });
    }
    const realMime = sniffImageMime(buffer);
    if (!realMime) {
      return reply.code(400).send({ error: 'bad_type', message: 'Нужна картинка (JPEG/PNG/WebP/GIF)' });
    }
    await employeesRepo.setAvatar(request.user!.employee_id!, buffer, realMime);
    return { ok: true };
    }
  );

  // Публичный (не requireActive) — <img src> не может передать Authorization
  // или Telegram initData-заголовок, а Telegram-канал (основной канал этого
  // приложения) резолвит identity ИСКЛЮЧИТЕЛЬНО по заголовку
  // (resolveTelegramIdentity), не по cookie — requireActive() здесь 401'ил
  // бы каждую аватарку, загруженную из Telegram Mini App.
  //
  // Hotfix 20.57.1 PASS 3, finding #6 — исправлена вводящая в заблуждение
  // формулировка выше: employees.id — обычный SERIAL (migrations/
  // 0001_baseline.sql), т.е. ПОСЛЕДОВАТЕЛЬНЫЙ и полностью перечисляемый
  // (1, 2, 3, ...), а не непредсказуемый идентификатор — раньше комментарий
  // ошибочно утверждал обратное. Реальная защита сейчас — только rate-limit
  // per-IP ниже, этого недостаточно против медленного полного перебора.
  // Браузер/desktop-канал (phone-провайдер, cookie-сессия) технически МОГ
  // бы получить auth здесь бесплатно — cookie летит на same-origin <img>
  // автоматически — но условной авторизации "только для не-Telegram
  // канала" тут нет: закрыть дыру по-настоящему для основного (Telegram)
  // канала требует отдельного транспорта (напр. короткоживущий подписанный
  // токен в query string, проверяемый на сервере отдельно от полной
  // сессии) — не однострочный фикс в рамках hotfix-прохода. DEFERRED,
  // см. PASS 3 finding #6 в финальном отчёте.
  app.get('/avatars/:employeeId', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { employeeId } = request.params as { employeeId: string };
    const row = await employeesRepo.getAvatar(Number(employeeId));
    if (!row?.avatar_data) {
      return reply.code(404).send();
    }
    reply.header('Cache-Control', 'private, max-age=300');
    return reply.type(row.avatar_mime || 'image/jpeg').send(row.avatar_data);
  });
}
