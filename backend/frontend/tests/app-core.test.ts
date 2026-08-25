/**
 * 21.x (Frontend rewrite — final two files) — jsdom test for
 * frontend/js/01-core.js → src/app/core.ts. Deeper coverage than the
 * batch-of-13's calibrated depth — this file owns shared mutable state
 * every other migrated bundle reads/writes as a bare identifier, so its
 * cross-bundle window-property mechanism gets its own dedicated checks here
 * (empirically verified separately via a standalone Node repro and the
 * full smoke test), on top of the usual behavior coverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function freshImport() {
  vi.resetModules();
  return import('../src/app/core.js');
}

describe('app/core (миграция frontend/js/01-core.js)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('tgUser', () => null);
    (window as any).apiClient = undefined;
    delete (window as any).Telegram;
  });

  it('устанавливает начальное состояние на window.*, а не на локальные let', async () => {
    await freshImport();
    expect(window.me).toBeNull();
    expect(window.stores).toEqual([]);
    expect(window.employees).toEqual([]);
    expect(window.saleSelection).toEqual({});
    expect(window.adminViewOrgId).toBeNull();
    expect(Array.isArray(window.METRICS)).toBe(true);
    expect(window.METRICS.length).toBeGreaterThan(0);
    expect(window.page).toBe('home');
  });

  it('бэйр-идентификатор me читает/пишет то же самое свойство, что window.me (межбандловый механизм)', async () => {
    await freshImport();
    // Симулируем то, что делают уже смигрированные модули (my-plan.ts и др.) — bare-присвоение без объявления.
    (0, eval)('me = { employee_id: 5, role: "admin" };');
    expect(window.me).toEqual({ employee_id: 5, role: 'admin' });
    expect((0, eval)('me')).toBe(window.me);
  });

  it('canAdmin/canManage/isSupervisor/canApprove/canViewAnalytics: без me — всё false', async () => {
    await freshImport();
    expect(window.canAdmin()).toBe(false);
    expect(window.canManage()).toBe(false);
    expect(window.isSupervisor()).toBe(false);
    expect(window.canApprove()).toBe(false);
    expect(window.canViewAnalytics()).toBe(false);
  });

  it('canManage: true для manager/admin/is_manager, false для обычного employee', async () => {
    await freshImport();
    window.me = { employee_id: 1, role: 'manager' };
    expect(window.canManage()).toBe(true);
    window.me = { employee_id: 1, role: 'admin' };
    expect(window.canManage()).toBe(true);
    window.me = { employee_id: 1, role: 'employee', is_manager: true };
    expect(window.canManage()).toBe(true);
    window.me = { employee_id: 1, role: 'employee' };
    expect(window.canManage()).toBe(false);
  });

  it('canAdmin: true только для role==="admin"', async () => {
    await freshImport();
    window.me = { employee_id: 1, role: 'manager' };
    expect(window.canAdmin()).toBe(false);
    window.me = { employee_id: 1, role: 'admin' };
    expect(window.canAdmin()).toBe(true);
  });

  it('isSupervisor/canApprove: supervisor approve-доступен через isSupervisor, не только canManage', async () => {
    await freshImport();
    window.me = { employee_id: 1, role: 'supervisor' };
    expect(window.isSupervisor()).toBe(true);
    expect(window.canManage()).toBe(false);
    expect(window.canApprove()).toBe(true);
  });

  it('canViewAnalytics: manager/admin/supervisor — true; senior/employee — false', async () => {
    await freshImport();
    for (const role of ['manager', 'admin', 'supervisor']) {
      window.me = { employee_id: 1, role };
      expect(window.canViewAnalytics()).toBe(true);
    }
    for (const role of ['senior', 'employee']) {
      window.me = { employee_id: 1, role };
      expect(window.canViewAnalytics()).toBe(false);
    }
  });

  it('assignableRoles: admin — все роли; manager — строго ниже своего уровня', async () => {
    await freshImport();
    expect(window.assignableRoles('admin')).toEqual(['trainee', 'employee', 'senior', 'manager', 'supervisor', 'admin']);
    expect(window.assignableRoles('manager')).toEqual(['trainee', 'employee', 'senior']);
    expect(window.assignableRoles('employee')).toEqual(['trainee']);
  });

  it('roleLabel: известные роли на русском, неизвестная — как есть', async () => {
    await freshImport();
    expect(window.roleLabel('manager')).toBe('Руководитель');
    expect(window.roleLabel('unknown_role')).toBe('unknown_role');
  });

  it('orgQueryParam: пусто без adminViewOrgId; &org_id=... для admin с переключённой сетью', async () => {
    await freshImport();
    window.me = { employee_id: 1, role: 'admin' };
    window.adminViewOrgId = null;
    expect(window.orgQueryParam()).toBe('');
    window.adminViewOrgId = 'org2';
    expect(window.orgQueryParam()).toBe('&org_id=org2');
    window.me = { employee_id: 1, role: 'manager' };
    expect(window.orgQueryParam()).toBe(''); // не-admin игнорируется, даже если adminViewOrgId стоит
  });

  it('esc: экранирует HTML-спецсимволы', async () => {
    await freshImport();
    expect(window.esc(`<script>"'&`)).toBe('&lt;script&gt;&quot;&#39;&amp;');
    expect(window.esc(null)).toBe('');
  });

  it('metricLabel/metricShort: находят по id, фолбэк на id/label для неизвестного', async () => {
    await freshImport();
    expect(window.metricLabel('sim')).toBe('SIM');
    expect(window.metricShort('phones')).toBe('Тел');
    expect(window.metricLabel('unknown_metric')).toBe('unknown_metric');
  });

  it('loadMetricsCatalog: подменяет METRICS данными с бэкенда, ошибка — не падает', async () => {
    await freshImport();
    const getMetrics = vi.fn().mockResolvedValue({ items: [{ id: 'x', label: 'X', short_label: 'X', unit: 'шт', unit_type: 'count' }] });
    (window as any).apiClient = { getMetrics };
    await window.loadMetricsCatalog();
    expect(window.METRICS).toEqual([{ id: 'x', label: 'X', short_label: 'X', unit: 'шт' }]);

    (window as any).apiClient = { getMetrics: vi.fn().mockRejectedValue(new Error('network')) };
    await expect(window.loadMetricsCatalog()).resolves.toBeUndefined();
  });

  it('fetchOrgStores: возвращает stores из ответа, [] при ошибке API', async () => {
    await freshImport();
    const getOrgStores = vi.fn().mockResolvedValue({ org_id: 'o1', stores: [{ id: 's1', name: 'A' }] });
    (window as any).apiClient = { getOrgStores };
    expect(await window.fetchOrgStores()).toEqual([{ id: 's1', name: 'A' }]);

    (window as any).apiClient = { getOrgStores: vi.fn().mockRejectedValue(new Error('fail')) };
    expect(await window.fetchOrgStores()).toEqual([]);
  });

  it('storeColor: свой цвет точки приоритетнее палитры, дефолт для неизвестной точки', async () => {
    await freshImport();
    expect(window.storeColor('kosmonavtov')).toBe('#6d9eeb');
    expect(window.storeColor('kosmonavtov', { color: '#ffffff' })).toBe('#ffffff');
    expect(window.storeColor('unknown_store')).toBe('#2aabee');
  });

  it('authHeaders: X-Telegram-Id из tgUser(), Content-Type только с json=true', async () => {
    await freshImport();
    vi.stubGlobal('tgUser', () => ({ id: 777 }));
    const h1 = window.authHeaders();
    expect(h1['X-Telegram-Id']).toBe('777');
    expect(h1['Content-Type']).toBeUndefined();
    const h2 = window.authHeaders(true);
    expect(h2['Content-Type']).toBe('application/json');
  });

  it('todayMoscow/timeMoscow/greetingByHour: не падают, возвращают строки в ожидаемом формате', async () => {
    await freshImport();
    expect(window.todayMoscow()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(window.timeMoscow('2026-08-25T10:00:00Z')).toMatch(/^\d{2}:\d{2}$/);
    expect(window.timeMoscow('')).toBe('');
    expect(window.timeMoscow('not-a-date')).toBe('');
    expect(['Доброй ночи', 'Доброе утро', 'Добрый день', 'Добрый вечер']).toContain(window.greetingByHour());
  });

  it('window.* мост — весь публичный набор функций реально функции', async () => {
    await freshImport();
    for (const name of [
      'todayMoscow',
      'timeMoscow',
      'haptic',
      'createSpring',
      'gestureVelocity',
      'esc',
      'greetingByHour',
      'canAdmin',
      'canManage',
      'isSupervisor',
      'canApprove',
      'roleLabel',
      'canViewAnalytics',
      'assignableRoles',
      'orgQueryParam',
      'fetchOrgStores',
      'storeColor',
      'authHeaders',
      'loadMetricsCatalog',
      'metricLabel',
      'metricShort'
    ]) {
      expect(typeof (window as any)[name]).toBe('function');
    }
    expect(typeof window.APP_VERSION).toBe('string');
    expect(typeof window.API).toBe('string');
  });
});
