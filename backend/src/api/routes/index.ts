/**
 * Регистрация всех доменных route-модулей — извлечено из app.ts (20.11.0,
 * репо-реструктуризация). Каждый модуль отвечает за свой домен, что где
 * искать — см. docs/ARCHITECTURE.md.
 */
import { FastifyInstance } from 'fastify';

import { registerPlansRoutes } from './plans.js';
import { registerEmployeesRoutes } from './org/employees.js';
import { registerStoresRoutes } from './org/stores.js';
import { registerAccessRoutes } from './org/access.js';
import { registerSessionRoutes } from './auth/session.js';
import { registerBrandingRoutes } from './org/branding.js';
import { registerSalesRoutes } from './sales.js';
import { registerSchedulesRoutes } from './schedules.js';
import { registerStatsRoutes } from './analytics/stats.js';
import { registerCashRoutes } from './cash.js';
import { registerPromosRoutes } from './promos.js';
import { registerReportsRoutes } from './ops/reports.js';
import { registerMeRoutes } from './me/index.js';
import { registerBfqRoutes } from './bfq.js';
import { registerExportRoutes } from './ops/export.js';
import { registerSupportRoutes } from './ops/support.js';
import { registerShiftsRoutes } from './shifts.js';
import { registerInsightsRoutes } from './analytics/insights.js';
import { registerLiveMapRoutes } from './analytics/live.js';
import { registerAlertsRoutes } from './ops/alerts.js';
import { registerWhatIfRoutes } from './analytics/what-if.js';
import { registerCommsRoutes } from './ops/comms.js';
import { registerForecastRoutes } from './analytics/forecast.js';
import { registerHeatmapRoutes } from './analytics/heatmap.js';
import { registerMetricsRoutes } from './metrics.js';
import { registerSupervisorRoutes } from './analytics/supervisor.js';
import { registerCommandCenterRoutes } from './analytics/command-center.js';
import { registerTasksRoutes } from './ops/tasks.js';
import { registerStoreProfileRoutes } from './profiles/store.js';
import { registerEmployeeProfileRoutes } from './profiles/employee.js';
import { registerAvatarRoutes } from './me/avatar.js';
import { registerAuditRoutes } from './audit.js';
import { registerDealersRoutes } from './org/dealers.js';

const routeModules: Array<[string, (app: FastifyInstance) => Promise<void>]> = [
  ['Plans', registerPlansRoutes],
  ['Employees', registerEmployeesRoutes],
  ['Stores', registerStoresRoutes],
  ['Access requests/sectors', registerAccessRoutes],
  ['Auth (не-Telegram вход)', registerSessionRoutes],
  ['Branding/orgs', registerBrandingRoutes],
  ['Sales', registerSalesRoutes],
  ['Schedules', registerSchedulesRoutes],
  ['Stats/Dashboard', registerStatsRoutes],
  ['Cash', registerCashRoutes],
  ['Promos', registerPromosRoutes],
  ['Reports (SVG)', registerReportsRoutes],
  ['Me/role', registerMeRoutes],
  ['BFQ', registerBfqRoutes],
  ['История/аудит/экспорт', registerExportRoutes],
  ['Support', registerSupportRoutes],
  ['Shifts/NLP/offline sync', registerShiftsRoutes],
  ['Insights (личная аналитика)', registerInsightsRoutes],
  ['Live map', registerLiveMapRoutes],
  ['Alerts', registerAlertsRoutes],
  ['What-if', registerWhatIfRoutes],
  ['Announcements/channels', registerCommsRoutes],
  ['Forecast/BI export', registerForecastRoutes],
  ['Heatmap', registerHeatmapRoutes],
  ['Metrics', registerMetricsRoutes],
  ['Supervisor', registerSupervisorRoutes],
  ['Command Center', registerCommandCenterRoutes],
  ['Tasks', registerTasksRoutes],
  ['Store Profile', registerStoreProfileRoutes],
  ['Employee Profile', registerEmployeeProfileRoutes],
  ['Avatar', registerAvatarRoutes],
  ['Audit', registerAuditRoutes],
  ['Dealers/Sectors', registerDealersRoutes]
];

export async function registerAllRoutes(app: FastifyInstance): Promise<void> {
  for (const [label, register] of routeModules) {
    try {
      await register(app);
      console.log(`✅ ${label} routes registered`);
    } catch (e: any) {
      console.error(`${label} routes failed:`, e?.message || e);
    }
  }
}
