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
import { authPlugin } from './middleware-auth.js';

import { registerCoreRoutes } from './routes-core.js';
import { registerEmployeesRoutes } from './routes-employees.js';
import { registerSalesRoutes } from './routes-sales.js';
import { registerSchedulesRoutes } from './routes-schedules.js';
import { registerStatsRoutes } from './routes-stats.js';
import { registerCashRoutes } from './routes-cash.js';
import { registerPromosRoutes } from './routes-promos.js';
import { registerReportsRoutes } from './routes-reports.js';
import { registerMeRoutes } from './routes-me.js';
import { registerBfqRoutes } from './routes-bfq.js';
import { registerExportRoutes } from './routes-export.js';
import { registerPlansV5Routes } from './routes-plans-v5.js';
import { registerV8Routes } from './routes-v8.js';
import { registerSupportRoutes } from './routes-support.js';
import { registerShiftsRoutes } from './routes-shifts.js';
import { registerInsightsRoutes } from './routes-insights.js';
import { registerLiveAlertsRoutes } from './routes-live-alerts.js';
import { registerCommsRoutes } from './routes-comms.js';
import { registerForecastRoutes } from './routes-forecast.js';
import { registerV14Routes } from './routes-v14.js';
import { registerMetricsRoutes } from './routes-metrics.js';
import { registerSupervisorRoutes } from './routes-supervisor.js';
import { registerCommandCenterRoutes } from './routes-command-center.js';
import { registerTasksRoutes } from './routes-tasks.js';
import { registerStoreProfileRoutes } from './routes-store-profile.js';
import { registerEmployeeProfileRoutes } from './routes-employee-profile.js';
import { registerAvatarRoutes } from './routes-avatar.js';

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
  // Каждый модуль отвечает за свой домен — что где искать, см. README §5.
  const routeModules: Array<[string, (app: FastifyInstance) => Promise<void>]> = [
    ['Core (stores/plans)', registerCoreRoutes],
    ['Employees', registerEmployeesRoutes],
    ['Sales', registerSalesRoutes],
    ['Schedules', registerSchedulesRoutes],
    ['Stats/Dashboard', registerStatsRoutes],
    ['Cash', registerCashRoutes],
    ['Promos', registerPromosRoutes],
    ['Reports (SVG)', registerReportsRoutes],
    ['Me/role', registerMeRoutes],
    ['BFQ', registerBfqRoutes],
    ['История/аудит/экспорт', registerExportRoutes],
    ['Plans v5', registerPlansV5Routes],
    ['Access (v8)', registerV8Routes],
    ['Support', registerSupportRoutes],
    ['Shifts/NLP/offline sync', registerShiftsRoutes],
    ['Insights (личная аналитика)', registerInsightsRoutes],
    ['Live map/alerts/what-if', registerLiveAlertsRoutes],
    ['Announcements/channels', registerCommsRoutes],
    ['Forecast/heatmap/BI export', registerForecastRoutes],
    ['V14 (branding, heatmap, tenant)', registerV14Routes],
    ['Metrics', registerMetricsRoutes],
    ['Supervisor', registerSupervisorRoutes],
    ['Command Center', registerCommandCenterRoutes],
    ['Tasks', registerTasksRoutes],
    ['Store Profile', registerStoreProfileRoutes],
    ['Employee Profile', registerEmployeeProfileRoutes],
    ['Avatar', registerAvatarRoutes],
  ];

  for (const [label, register] of routeModules) {
    try {
      await register(app);
      console.log(`✅ ${label} routes registered`);
    } catch (e: any) {
      console.error(`${label} routes failed:`, e?.message || e);
    }
  }

  return app;
}
