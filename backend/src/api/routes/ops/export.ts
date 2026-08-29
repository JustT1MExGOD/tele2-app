/**
 * История продаж, аудит правок, CSV-экспорты (продажи/BFQ/график).
 * Выделено из routes-v3.ts.
 */
import { FastifyInstance, FastifyRequest } from 'fastify';
import { calculateAllBFQ } from '../../../core/bfq/service.js';
import { requireActive, requireManager, isManager, resolveViewOrgId } from '../../../auth/guards.js';
import { todayMoscow, currentMonthMoscow } from '../../../utils/date.js';
import { record as recordAudit } from '../../../data/repositories/audit.js';
import * as salesRepo from '../../../data/repositories/sales.js';
import * as schedulesRepo from '../../../data/repositories/schedules.js';

// 19.23.0 (Audit Trail) — экспорт не мутация, просто фиксируем факт "кто
// когда что выгрузил" (data exfiltration угол из исходного ревью). Ошибку
// не глушим намеренно, но и не блокируем ответ — файл уже готов к этому
// моменту, отдаём его синхронно, аудит пишем fire-and-forget с логом сбоя.
function auditExport(request: FastifyRequest, orgId: string, targetId: string, filters: Record<string, unknown>) {
  recordAudit({
    orgId,
    actorEmployeeId: request.user!.employee_id,
    actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
    action: 'export.csv',
    targetType: 'export',
    targetId,
    after: filters,
    requestId: request.id,
    actorRole: request.user!.role
  }).catch((e: any) => request.log.error(e, 'audit write failed for export.csv'));
}

function csvEscape(v: any) {
  const s = String(v ?? '');
  if (/[;"\n,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// 20.50.0 (Web Security & Trust Layer, часть 3) — findForCsvExport() не
// несёт LIMIT (в отличие от findSalesAudit(), у которой уже есть LIMIT 500,
// см. data/repositories/sales.ts) — тихо обрезать строки было бы хуже для
// файла, которым реально пользуется бухгалтерия (неполные данные без
// предупреждения), поэтому ограничиваем ШИРИНУ диапазона явной ошибкой,
// не количество строк молча.
const MAX_EXPORT_RANGE_DAYS = 400;
function rangeTooWide(from: string, to: string): boolean {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
  return days > MAX_EXPORT_RANGE_DAYS;
}

export async function registerExportRoutes(app: FastifyInstance) {
  // ========== HISTORY ==========
  app.get('/sales/history', async (request, reply) => {
    if (!requireActive(request, reply)) return;

    const q = request.query as {
      from?: string;
      to?: string;
      employee_id?: string;
      store_id?: string;
      limit?: string;
      org_id?: string;
    };

    const from = q.from || todayMoscow().slice(0, 8) + '01';
    const to = q.to || todayMoscow();
    const limit = Math.min(Number(q.limit) || 500, 2000);
    const orgId = resolveViewOrgId(request.user!, q.org_id);

    // employee видит только себя, manager — всех своей сети
    let employeeFilter = q.employee_id ? Number(q.employee_id) : null;
    if (!isManager(request.user) && request.user) {
      employeeFilter = request.user.employee_id;
    }

    // Раньше manager видел историю продаж ВСЕХ сетей сразу — теперь только
    // своей (или явно выбранной admin-переключателем); своя запись видна
    // всегда, даже если сегодня подменяешь в чужой сети.
    const rows = await salesRepo.findHistory({
      from, to, orgId, ownEmployeeId: request.user!.employee_id,
      employeeFilter, storeId: q.store_id || null, limit
    });
    return { from, to, count: rows.length, items: rows };
  });

  app.get(
    '/sales/audit',
    // 20.50.0 — уже LIMIT 500 в SQL (findSalesAudit), лимит здесь только
    // для консистентности с остальными export-роутами.
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const q = request.query as { from?: string; to?: string; employee_id?: string; org_id?: string };
    const from = q.from || todayMoscow().slice(0, 8) + '01';
    const to = q.to || todayMoscow();
    const orgId = resolveViewOrgId(request.user!, q.org_id);
    return salesRepo.findSalesAudit({
      from, to, orgId, employeeId: q.employee_id ? Number(q.employee_id) : null
    });
    }
  );

  // ========== EXPORT ==========
  app.get(
    '/export/sales.csv',
    // 20.50.0 — findForCsvExport() не имеет LIMIT (см. rangeTooWide выше);
    // единственный реально неограниченный export в приложении.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;

    const q = request.query as { from?: string; to?: string; store_id?: string; org_id?: string };
    const from = q.from || todayMoscow().slice(0, 8) + '01';
    const to = q.to || todayMoscow();
    if (rangeTooWide(from, to)) {
      return reply.code(400).send({
        error: 'range_too_wide',
        message: `Сузьте диапазон дат — максимум ${MAX_EXPORT_RANGE_DAYS} дней за один экспорт`
      });
    }
    const orgId = resolveViewOrgId(request.user!, q.org_id);
    const rows = await salesRepo.findForCsvExport({ from, to, orgId, storeId: q.store_id || null });
    const header = [
      'date', 'employee', 'store', 'code',
      'sim', 'mnp', 'pa', 'combo', 'phones', 'accessories',
      'insurance', 'wink', 'shpd', 'focus', 'settings',
      'credit_request', 'credit_issued', 'plotter', 'hb'
    ];

    const lines = [header.join(';')];
    for (const r of rows) {
      lines.push([
        String(r.sale_date).slice(0, 10),
        r.full_name, r.store_name, r.code,
        r.sim, r.mnp, r.pa, r.combo, r.phones, r.accessories,
        r.insurance, r.wink, r.shpd, r.focus, r.settings,
        r.credit_request, r.credit_issued, r.plotter, r.hb
      ].map(csvEscape).join(';'));
    }

    auditExport(request, orgId, 'sales', { from, to, store_id: q.store_id || null });

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="sales_${from}_${to}.csv"`)
      .send('﻿' + lines.join('\n'));
    }
  );

  app.get(
    '/export/bfq.csv',
    // 20.50.0 — уже естественно ограничен одним месяцем, лимит для консистентности.
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { month, org_id } = request.query as { month?: string; org_id?: string };
    const m = month || currentMonthMoscow();
    const orgId = resolveViewOrgId(request.user!, org_id);
    const items = await calculateAllBFQ(m, orgId);

    const header = [
      'employee', 'bfq_fact', 'bfq_forecast', 'quality', 'profit',
      'vmr', 'penalty', 'sim_pct', 'mnp_pct', 'pa_pct', 'combo_pct',
      'phones_pct', 'worked_shifts', 'remaining_shifts'
    ];
    const lines = [header.join(';')];
    for (const r of items) {
      lines.push([
        r.full_name,
        r.total,
        r.forecast,
        r.quality,
        r.profit,
        r.vmr,
        r.penalty,
        r.pct?.sim,
        r.pct?.mnp,
        r.pct?.pa,
        r.pct?.combo,
        r.pct?.phones,
        r.shifts?.worked,
        r.shifts?.remaining
      ].map(csvEscape).join(';'));
    }

    auditExport(request, orgId, 'bfq', { month: m });

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="bfq_${m}.csv"`)
      .send('﻿' + lines.join('\n'));
    }
  );

  app.get(
    '/export/schedules.csv',
    // 20.50.0 — уже естественно ограничен одним месяцем, лимит для консистентности.
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { month, org_id } = request.query as { month?: string; org_id?: string };
    const m = month || currentMonthMoscow();
    const orgId = resolveViewOrgId(request.user!, org_id);
    const start = `${m}-01`;
    const endDate = new Date(`${m}-01T12:00:00`);
    endDate.setMonth(endDate.getMonth() + 1);
    const end = endDate.toISOString().slice(0, 10);

    const rows = await schedulesRepo.findForCsvExport(start, end, orgId);

    const header = ['date', 'employee', 'store', 'code', 'shift', 'hours'];
    const lines = [header.join(';')];
    for (const r of rows) {
      lines.push([
        String(r.work_date).slice(0, 10),
        r.full_name, r.store_name, r.code, r.shift_text, r.hours
      ].map(csvEscape).join(';'));
    }

    auditExport(request, orgId, 'schedules', { month: m });

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="schedules_${m}.csv"`)
      .send('﻿' + lines.join('\n'));
    }
  );
}
