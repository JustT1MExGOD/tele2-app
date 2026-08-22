/**
 * Typed API client (20.0.0+) — покрывает getOrgStores/getMetrics (01-core.js),
 * промокоды РТК (12-promos.js, 20.1.0), кассу + кастомные метрики
 * (09-cash-metrics.js, 20.2.0), сводку по сети (19-reports.js, 20.3.0),
 * алерты (17-alerts.js, 20.4.0), задачи (15-tasks.js, 20.5.0) и Command
 * Center (14-command-center.js, 20.6.0): верный URL/метод/заголовки/тело, проброс
 * org_id-квери-параметра, throw на не-ok ответе с серверным
 * {error/message} вместо голого статус-кода — message ПЕРВЫМ (не error;
 * поменяно в 20.2.0, см. api-client.ts) — клиент сам не глотает ошибку и
 * не подставляет фолбэк, это остаётся задачей вызывающего кода.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getOrgStores,
  getMetrics,
  getPromos,
  getPromoCard,
  createPromo,
  markPromoUsed,
  keepPromo,
  getCashTable,
  saveCash,
  createMetric,
  deleteMetric,
  sendNetworkDigest,
  getAlerts,
  changeAlertStatus,
  getTasks,
  getTask,
  changeTaskStatus,
  addTaskComment,
  getCommandCenter,
  getEmployees,
  createTask
} from '../src/api-client.js';

function fetchOk(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body
  })) as unknown as typeof fetch;
}

describe('api-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchOk({}));
  });

  it('getOrgStores — верный URL и заголовки, без org_id-квери', async () => {
    const fetchMock = fetchOk({ org_id: 'default', stores: [] });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42' };

    const result = await getOrgStores(headers, '');

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/org/stores`, { headers });
    expect(result).toEqual({ org_id: 'default', stores: [] });
  });

  it('getOrgStores — пробрасывает org_id-квери', async () => {
    const fetchMock = fetchOk({ org_id: 'other-org', stores: [] });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42' };

    await getOrgStores(headers, '&org_id=other-org');

    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/org/stores?org_id=other-org`,
      { headers }
    );
  });

  it('getMetrics — верный URL и заголовки', async () => {
    const fetchMock = fetchOk({ items: [{ id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'шт', unit_type: 'count' }] });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42' };

    const result = await getMetrics(headers);

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/metrics`, { headers });
    expect(result.items).toHaveLength(1);
  });

  it('бросает на не-ok ответе, не глотает ошибку', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch);

    await expect(getOrgStores({}, '')).rejects.toThrow('api_error:/org/stores:500');
  });

  it('getPromos — верный URL и заголовки, пробрасывает org_id-квери', async () => {
    const fetchMock = fetchOk({ items: [] });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42' };

    await getPromos(headers, '&org_id=other-org');

    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/promos?org_id=other-org`,
      { headers }
    );
  });

  it('getPromoCard — верный URL с id, без квери', async () => {
    const fetchMock = fetchOk({ id: 7, code: 'ABCD-1234', note: null, created_by_name: 'Иван', created_at: '2026-01-01' });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42' };

    const result = await getPromoCard(headers, 7);

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/promos/7`, { headers });
    expect(result.code).toBe('ABCD-1234');
  });

  it('createPromo — POST с телом и Content-Type-заголовком от вызывающего кода', async () => {
    const fetchMock = fetchOk({ ok: true, item: { id: 1, code: 'X', note: null, created_at: '2026-01-01' } });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42', 'Content-Type': 'application/json' };

    await createPromo(headers, { code: 'X', note: 'заметка' });

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/promos`, {
      headers,
      method: 'POST',
      body: JSON.stringify({ code: 'X', note: 'заметка' })
    });
  });

  it('markPromoUsed/keepPromo — POST на /promos/:id/use и /keep с пустым телом', async () => {
    const fetchMock = fetchOk({ ok: true, used: true });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42' };

    await markPromoUsed(headers, 9);
    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/promos/9/use`, {
      headers, method: 'POST', body: '{}'
    });

    await keepPromo(headers, 9);
    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/promos/9/keep`, {
      headers, method: 'POST', body: '{}'
    });
  });

  it('createPromo — на не-ok surfacing серверного {error}, не голого статус-кода', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'code_required' }) })) as unknown as typeof fetch
    );

    await expect(createPromo({}, { code: '' })).rejects.toThrow('code_required');
  });

  it('getCashTable — верный URL с from/to и org_id-квери', async () => {
    const fetchMock = fetchOk({ from: '2026-01-01', to: '2026-01-31', stores: [], dates: [], cells: {} });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42' };

    await getCashTable(headers, '2026-01-01', '2026-01-31', '&org_id=other-org');

    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/cash/table?from=2026-01-01&to=2026-01-31&org_id=other-org`,
      { headers }
    );
  });

  it('saveCash — PUT с телом', async () => {
    const fetchMock = fetchOk({ id: 1, store_id: 's1', cash_date: '2026-01-01', cash_fact: 100, cash_1c: 90, comment: null, created_by: null, updated_at: '2026-01-01' });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42', 'Content-Type': 'application/json' };
    const body = { store_id: 's1', cash_date: '2026-01-01', cash_fact: 100, cash_1c: 90 };

    await saveCash(headers, body);

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/cash`, {
      headers, method: 'PUT', body: JSON.stringify(body)
    });
  });

  it('createMetric — POST с телом', async () => {
    const fetchMock = fetchOk({ ok: true, item: { id: 'esim', label: 'eSIM', short_label: 'eSIM', unit: 'шт', unit_type: 'count' } });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42', 'Content-Type': 'application/json' };
    const body = { label: 'eSIM', short_label: 'eSIM', unit: 'count' };

    await createMetric(headers, body);

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/metrics`, {
      headers, method: 'POST', body: JSON.stringify(body)
    });
  });

  it('deleteMetric — DELETE без тела', async () => {
    const fetchMock = fetchOk({ ok: true, id: 'esim', active: false });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42' };

    await deleteMetric(headers, 'esim');

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/metrics/esim`, {
      headers, method: 'DELETE'
    });
  });

  it('deleteMetric — на не-ok бросает message, не error (message-first)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false, status: 400,
        json: async () => ({ error: 'locked', message: 'Базовую метрику нельзя удалить' })
      })) as unknown as typeof fetch
    );

    await expect(deleteMetric({}, 'sim')).rejects.toThrow('Базовую метрику нельзя удалить');
  });

  it('sendNetworkDigest — POST с телом {kind}', async () => {
    const fetchMock = fetchOk({ ok: true, kind: 'weekly' });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42', 'Content-Type': 'application/json' };

    const result = await sendNetworkDigest(headers, { kind: 'weekly' });

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/reports/send-digest`, {
      headers, method: 'POST', body: JSON.stringify({ kind: 'weekly' })
    });
    expect(result.kind).toBe('weekly');
  });

  it('getAlerts — верный URL со status и org_id-квери', async () => {
    const fetchMock = fetchOk([]);
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42' };

    await getAlerts(headers, 'open', '&org_id=other-org');

    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/alerts?status=open&org_id=other-org`,
      { headers }
    );
  });

  it('changeAlertStatus — POST с телом {status}', async () => {
    const fetchMock = fetchOk({ id: 5, status: 'resolved' });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42', 'Content-Type': 'application/json' };

    await changeAlertStatus(headers, 5, { status: 'resolved' });

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/alerts/5/status`, {
      headers, method: 'POST', body: JSON.stringify({ status: 'resolved' })
    });
  });

  it('getTasks — верный URL с cache-bust и org_id-квери', async () => {
    const fetchMock = fetchOk([]);
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42' };

    await getTasks(headers, '&org_id=other-org');

    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/tasks?_=1&org_id=other-org`,
      { headers }
    );
  });

  it('getTask — верный URL с id', async () => {
    const fetchMock = fetchOk({ task: { id: 3, title: 'X' }, comments: [] });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42' };

    const result = await getTask(headers, 3);

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/tasks/3`, { headers });
    expect(result.task.id).toBe(3);
  });

  it('changeTaskStatus — POST с телом {status}', async () => {
    const fetchMock = fetchOk({ id: 3, status: 'done' });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42', 'Content-Type': 'application/json' };

    await changeTaskStatus(headers, 3, { status: 'done' });

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/tasks/3/status`, {
      headers, method: 'POST', body: JSON.stringify({ status: 'done' })
    });
  });

  it('addTaskComment — POST с телом {body}', async () => {
    const fetchMock = fetchOk({ id: 1, task_id: 3, author_id: 42, body: 'привет', created_at: '2026-01-01' });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42', 'Content-Type': 'application/json' };

    await addTaskComment(headers, 3, { body: 'привет' });

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/tasks/3/comments`, {
      headers, method: 'POST', body: JSON.stringify({ body: 'привет' })
    });
  });

  it('getCommandCenter — верный URL с cache-bust и org_id-квери', async () => {
    const fetchMock = fetchOk({ date: '2026-01-01', network: {}, stores: [], problems: [], underperforming_count: 0, alerts_count: 0, generated_at: '2026-01-01' });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42' };

    await getCommandCenter(headers, '&org_id=other-org');

    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/command-center?_=1&org_id=other-org`,
      { headers }
    );
  });

  it('getEmployees — принимает уже собранную query-строку как есть', async () => {
    const fetchMock = fetchOk([]);
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42' };

    await getEmployees(headers, '?org_id=other-org');

    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/employees?org_id=other-org`,
      { headers }
    );
  });

  it('createTask — POST с телом', async () => {
    const fetchMock = fetchOk({ id: 9, title: 'X', status: 'open' });
    vi.stubGlobal('fetch', fetchMock);
    const headers = { 'X-Telegram-Id': '42', 'Content-Type': 'application/json' };
    const body = { title: 'X', assigned_to: 1 };

    await createTask(headers, body);

    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/tasks`, {
      headers, method: 'POST', body: JSON.stringify(body)
    });
  });
});
