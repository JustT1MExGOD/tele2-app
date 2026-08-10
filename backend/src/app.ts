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

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // Единая точка резолва пользователя (telegram_id проверяется по подписи
  // Telegram initData внутри authPlugin) — вешаем один раз на всё приложение.
  app.addHook('preHandler', authPlugin);

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
