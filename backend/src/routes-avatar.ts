/**
 * Кастомная аватарка (батч 3, п.19). Railway — эфемерная ФС, S3/CDN не
 * подключены — храним байты прямо в employees.avatar_data (bytea).
 * Клиент уже присылает сжатую ~256×256 картинку (canvas-ресайз в
 * 05-my-plan.js) — лимит здесь просто страховка от чужого клиента.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireAuth } from './middleware-auth.js';

const MAX_AVATAR_BYTES = 1.5 * 1024 * 1024;

export async function registerAvatarRoutes(app: FastifyInstance) {
  app.post('/me/avatar', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const data = await request.file({ limits: { fileSize: MAX_AVATAR_BYTES } }).catch(() => null);
    if (!data) {
      return reply.code(400).send({ error: 'no_file', message: 'Файл не получен' });
    }
    if (!data.mimetype?.startsWith('image/')) {
      return reply.code(400).send({ error: 'bad_type', message: 'Нужна картинка' });
    }
    const buffer = await data.toBuffer().catch(() => null);
    if (!buffer || !buffer.length) {
      return reply.code(400).send({ error: 'empty_file', message: 'Пустой файл' });
    }
    if (buffer.length > MAX_AVATAR_BYTES) {
      return reply.code(413).send({ error: 'too_large', message: 'Слишком большой файл' });
    }
    await query(
      `UPDATE employees SET avatar_data = $1, avatar_mime = $2 WHERE id = $3`,
      [buffer, data.mimetype, request.user!.employee_id]
    );
    return { ok: true };
  });

  // Публичный (не requireAuth) — <img src> не может передать Authorization.
  // employeeId сам по себе не перечисляемый список, тот же уровень защиты,
  // что уже есть у других некритичных публичных полей (store.color и т.п.).
  app.get('/avatars/:employeeId', async (request, reply) => {
    const { employeeId } = request.params as { employeeId: string };
    const res = await query(
      `SELECT avatar_data, avatar_mime FROM employees WHERE id = $1`,
      [Number(employeeId)]
    );
    const row = res.rows[0];
    if (!row?.avatar_data) {
      return reply.code(404).send();
    }
    reply.header('Cache-Control', 'private, max-age=300');
    return reply.type(row.avatar_mime || 'image/jpeg').send(row.avatar_data);
  });
}
