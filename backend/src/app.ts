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
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { todayMoscow } from './utils/date.js';
import { authPlugin } from './auth/guards.js';
import { requireCsrf } from './auth/csrf.js';
import { registerAllRoutes } from './api/routes/index.js';
import { pool } from './data/db/index.js';
import { markApplicationReady, isApplicationReady } from './platform/observability/readiness.js';
import { metricsRegistry, httpRequestsTotal, httpRequestDuration, httpRequestsInFlight } from './platform/observability/metrics.js';

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
    // 20.48.0 — Railway кладёт приложение за ровно одним reverse-proxy
    // хопом; доверяем ровно ему (не `true`, который принял бы любую цепочку
    // X-Forwarded-For) — иначе request.ip не соответствует реальному
    // клиенту, что подрывает точность IP-based rate-limit (app.ts ниже).
    trustProxy: 1,
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
  // Не-Telegram вход (20.35, план) — cookie-сессия для phone-provider'а
  // (providers/phone.ts). Секрет не нужен: значение cookie — непрозрачный
  // случайный токен, в БД хранится только его sha256, не подпись.
  await app.register(cookie);
  // Внутренний чат (20.57.0) — единственный потребитель WS в проекте
  // сейчас; connectSrc: ["'self'"] в CSP ниже уже покрывает same-origin
  // wss:// без отдельного изменения директивы (см. итоговый отчёт чата).
  await app.register(websocket);

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

  // ===== HTTP-метрики (20.32.0) =====
  // route = паттерн (`/employees/:id`), не резолвнутый URL — иначе каждый
  // конкретный id даёт свою time-серию навсегда (unbounded cardinality).
  // request.routeOptions.url — undefined на 404 (роут не найден вообще),
  // тогда лейбл 'not_found' — без него сюда утёк бы сырой request.url,
  // тот же риск кардинальности от сканеров/ботов, что перебирают пути.
  app.addHook('onRequest', async (request) => {
    const route = request.routeOptions?.url || 'not_found';
    httpRequestsInFlight.inc({ method: request.method, route });
  });
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url || 'not_found';
    const status = String(reply.statusCode);
    httpRequestsInFlight.dec({ method: request.method, route });
    httpRequestsTotal.inc({ method: request.method, route, status });
    httpRequestDuration.observe({ method: request.method, route, status }, reply.elapsedTime / 1000);
  });

  // 20.49.0 (Web Security & Trust Layer, часть 2) — auth/session/employee-
  // PII-ответы раньше не несли никакого Cache-Control вообще, полагаясь на
  // умолчания браузера; общий кэширующий прокси/CDN мог бы закэшировать
  // чужой ответ. `!reply.getHeader('cache-control')` — единственное условие,
  // покрывает оба существующих исключения БЕЗ явного списка путей:
  // GET /avatars/:id уже ставит свой `private, max-age=300` до onSend
  // (пропускается), @fastify/static (cacheControl:true по умолчанию) тоже
  // успевает выставить свой заголовок до этого хука.
  // Permissions-Policy (20.52.0) — @fastify/helmet 13.x не включает этот
  // заголовок ни в дефолты, ни как отдельный экспорт (проверено чтением
  // node_modules/helmet напрямую). Единственный Browser Permissions API,
  // которым реально пользуется фронтенд — geolocation (открытие/закрытие
  // смены, pages/shift/index.ts); camera/microphone/usb/payment и т.д.
  // явно закрыты, не оставлены на дефолт браузера. Объединено с
  // Cache-Control в ОДНОМ onSend-хуке намеренно — второй отдельный
  // app.addHook('onSend', ...) в этом месте цепочки стабильно
  // воспроизводил "Cannot write headers after they are sent" на
  // multipart-роутах (POST /me/avatar) при раннем return из requireAuth
  // (гонка @fastify/multipart's stream cleanup с количеством/порядком
  // onSend-хуков) — найдено и закрыто до пуша, один hook с двумя
  // заголовками эту гонку не даёт.
  app.addHook('onSend', async (request, reply, payload) => {
    if (!reply.getHeader('cache-control')) reply.header('Cache-Control', 'no-store');
    if (!reply.getHeader('permissions-policy')) {
      reply.header(
        'Permissions-Policy',
        'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()'
      );
    }
    return payload;
  });

  // Единая точка резолва пользователя (telegram_id проверяется по подписи
  // Telegram initData внутри authPlugin) — вешаем один раз на всё приложение.
  app.addHook('preHandler', authPlugin);
  // 20.48.0 — CSRF сразу после резолва identity: срабатывает только на
  // мутирующих запросах с cookie-сессией (t2_session), Telegram-путь не
  // затрагивает вообще (см. auth/csrf.ts).
  app.addHook('preHandler', requireCsrf);

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

  // ===== Health/readiness semantics (20.32.0) =====
  // /healthz — жив ли процесс. Никаких внешних зависимостей (БД, Telegram) —
  // если Postgres временно недоступен, процесс всё ещё жив и может это
  // пережить, это не повод перезапускать контейнер.
  app.get('/healthz', async () => ({ status: 'ok' }));

  // /readyz — может ли ЭТОТ инстанс прямо сейчас обслуживать нагрузку.
  // bootstrap (миграции + buildApp()) уже гарантированно завершён к моменту,
  // когда сюда вообще может прийти запрос (index.ts гоняет миграции ДО
  // buildApp(), см. platform/observability/readiness.ts) — единственное,
  // что реально может стать false ПОСЛЕ старта, это доступность БД, поэтому
  // проверяем оба: и флаг (на случай будущего async warmup), и живой пинг.
  // Намеренно НЕ включает bot polling — это интеграция, а не условие
  // способности Core API обслуживать HTTP; если polling завтра переедет в
  // отдельный процесс, readiness не должен внезапно стать 503.
  app.get('/readyz', async (_request, reply) => {
    if (!isApplicationReady()) {
      reply.code(503);
      return { status: 'not_ready', reason: 'bootstrap_incomplete' };
    }
    try {
      await pool.query('SELECT 1');
    } catch (e: any) {
      reply.code(503);
      return { status: 'not_ready', reason: 'database_unreachable' };
    }
    return { status: 'ready' };
  });

  // /integrations/health — необязательный диагностический срез: какие
  // внешние интеграции сконфигурированы. НЕ бьёт живым запросом ни в
  // Telegram, ни в Groq (тратить AI-квоту/добавлять задержку на health-чек
  // бессмысленно) — только наличие нужных env-переменных.
  app.get('/integrations/health', async () => ({
    telegram: { configured: !!process.env.BOT_TOKEN },
    ai: { configured: !!process.env.GROQ_API_KEY }
  }));

  // /metrics/system — Prometheus exposition format. НЕ /metrics: та строка
  // уже занята бизнес-каталогом кастомных метрик (api/routes/metrics.ts,
  // существует с ранних версий проекта) — коллизия найдена security-
  // аудитом 20.52.1: Fastify бросает на повторной регистрации того же
  // роута, registerAllRoutes() ловил это тихо (см. api/routes/index.ts) и
  // весь GET/POST/DELETE /metrics business-модуль молча не регистрировался
  // ни разу с момента появления этого Prometheus-эндпоинта. Никто не
  // обязан scrape'ить этот путь постоянно — сама возможность есть, коллектор
  // подключается отдельно, когда реально понадобится.
  app.get('/metrics/system', async (_request, reply) => {
    reply.header('Content-Type', metricsRegistry.contentType);
    return metricsRegistry.metrics();
  });

  // ===== Регистрация всех модулей с роутами =====
  // Что где искать — см. docs/ARCHITECTURE.md. Список модулей и порядок
  // регистрации живут в api/routes/index.ts, не здесь.
  await registerAllRoutes(app);

  markApplicationReady();
  return app;
}
