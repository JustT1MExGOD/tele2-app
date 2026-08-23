/**
 * Сборка Fastify-приложения: создание инстанса, CORS, auth-хук, статика
 * фронтенда, health-роут и регистрация всех доменных модулей роутов.
 * Вынесено из index.ts (эпик 17.0) — тестам нужен инстанс с зарегистри-
 * рованными роутами для app.inject(), но БЕЗ побочных эффектов (listen(),
 * бот, cron, анонс релиза) — те остаются в index.ts, единственном месте,
 * которое реально запускает процесс.
 */
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { todayMoscow } from './utils/date.js';
import { authPlugin } from './auth/guards.js';
import { registerAllRoutes } from './api/routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findFrontendDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'frontend'),
    path.join(process.cwd(), '../frontend'),
    path.join(__dirname, '../frontend'),
    path.join(__dirname, '../../frontend'),
    path.join(process.cwd(), 'public'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      console.log('Frontend found:', dir);
      return dir;
    }
  }
  console.warn('Frontend not found');
  return null;
}

/** Известные коды ошибок Postgres → стабильный HTTP-ответ вместо голого 500
 * с сырым текстом драйвера (может содержать имена колонок/constraint'ов). */
const PG_ERROR_MAP: Record<string, { statusCode: number; error: string; message: string }> = {
  '23505': { statusCode: 409, error: 'conflict', message: 'Запись уже существует' },
  '23503': { statusCode: 400, error: 'invalid_reference', message: 'Ссылка на несуществующую запись' },
  '23514': { statusCode: 400, error: 'invalid_input', message: 'Некорректные данные' },
  '22003': { statusCode: 400, error: 'invalid_input', message: 'Значение вне допустимого диапазона' },
  '22P02': { statusCode: 400, error: 'invalid_input', message: 'Некорректный формат данных' }
};

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      // initData/токены никогда не должны попасть в логи — сериализаторы
      // pino по умолчанию и так не включают headers, redact здесь просто
      // страховка на случай, если это когда-нибудь изменится.
      redact: {
        paths: ['req.headers["x-telegram-init-data"]', 'req.headers["x-telegram-initdata"]', 'req.headers.authorization'],
        censor: '[redacted]'
      }
    }
  });
  // origin: true (было) отражал ЛЮБОЙ Origin — но фронтенд всегда бьёт на
  // API тем же доменом, с которого сам загружен (API = window.location.origin
  // в 01-core.js), а бот открывает Mini App той же ссылкой (MINI_APP_URL —
  // тот же Railway-домен). Легитимного кросс-origin браузерного вызова нет
  // ни в одном сценарии — origin: false явно это фиксирует (браузер сам
  // блокирует кросс-origin чтение ответа; не-браузерные вызовы — curl,
  // Node fetch, тестовый набор — CORS вообще не касается, это чисто
  // браузерный механизм).
  await app.register(cors, { origin: false });
  await app.register(multipart);

  // Заголовки безопасности. CSP собрана под реальную структуру фронтенда
  // (без CSP-соответствующей автоматической проверки один раз в начале):
  // 6400+ строк JS рендерят разметку через innerHTML с onclick="" / style=""
  // прямо в атрибутах (74 onclick в index.html, 284 style-атрибута в js/*.js) —
  // это отдельная, более крупная переделка (см. заметку в чате), не тут.
  // Поэтому script-src-attr/style-src-attr разрешены как 'unsafe-inline' —
  // без этого перестанут работать вообще все клики в приложении. Инлайновых
  // <script>/<style> БЛОКОВ (не атрибутов) в разметке нет — тем script-src/
  // style-src самих себя 'unsafe-inline' не нужен.
  // frame-ancestors вместо xFrameOptions: Telegram Web открывает Mini App
  // в iframe с web.telegram.org — X-Frame-Options: SAMEORIGIN это бы сломал;
  // современные браузеры отдают приоритет CSP frame-ancestors, поэтому сам
  // X-Frame-Options просто выключен, а не выставлен пермиссивно (легаси-
  // браузеры внутри Telegram-клиентов не ожидаются).
  // crossOriginEmbedderPolicy выключен — иначе блокируется кросс-доменный
  // <script src="https://telegram.org/js/telegram-web-app.js"> (у него нет
  // Cross-Origin-Resource-Policy заголовка).
  await app.register(helmet, {
    xFrameOptions: false,
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://telegram.org'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        styleSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org']
      }
    }
  });

  // Глобальный лимит на IP — защита от долбёжки API (в т.ч. с невалидным
  // initData, который до auth-проверки ещё не даёт request.user для более
  // точного ключа). Отдельные чувствительные роуты (заявка на доступ,
  // аватарки, генерация отчётов) получают свой более жёсткий лимит через
  // config.rateLimit в самом роуте — этот просто общий потолок.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute'
  });

  // Единая точка резолва пользователя (telegram_id проверяется по подписи
  // Telegram initData внутри authPlugin) — вешаем один раз на всё приложение.
  app.addHook('preHandler', authPlugin);

  // Сеть роутов, где ошибка не поймана вручную (throw/reject без try/catch),
  // раньше уходила клиенту через дефолтный Fastify-хендлер как есть — с
  // сырым err.message (для ошибок pg это может быть текст с именами колонок/
  // constraint'ов). Отдельные роуты с собственным catch это не затрагивает —
  // они уже отвечают через serverError() (src/utils/http-errors.ts).
  app.setErrorHandler((err: any, request, reply) => {
    request.log.error(err);
    // TypeBox/Fastify schema-валидация (эпик 19.18+) — err.validation несёт
    // структурированный список того, что именно не сошлось (instancePath +
    // message от ajv), полезнее голого err.message с одной первой ошибкой.
    if (err?.code === 'FST_ERR_VALIDATION' && Array.isArray(err.validation)) {
      return reply.code(400).send({
        error: 'validation_failed',
        message: 'Некорректные данные запроса',
        details: err.validation.map((v: any) => ({ path: v.instancePath || v.schemaPath, message: v.message }))
      });
    }
    const mapped = typeof err?.code === 'string' ? PG_ERROR_MAP[err.code] : undefined;
    if (mapped) {
      return reply.code(mapped.statusCode).send({ error: mapped.error, message: mapped.message });
    }
    if (typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: 'bad_request', message: err.message });
    }
    return reply.code(500).send({ error: 'internal_error', message: 'Внутренняя ошибка сервера' });
  });

  const frontendDir = findFrontendDir();
  if (frontendDir) {
    await app.register(fastifyStatic, { root: frontendDir, prefix: '/' });
  }

  // ===== HEALTH =====
  app.get('/health', async () => ({
    status: 'ok',
    time: new Date().toISOString(),
    today: todayMoscow(),
  }));

  // ===== Регистрация всех модулей с роутами =====
  // Что где искать — см. docs/ARCHITECTURE.md. Список модулей и порядок
  // регистрации живут в api/routes/index.ts, не здесь.
  await registerAllRoutes(app);

  return app;
}
