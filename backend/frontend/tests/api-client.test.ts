/**
 * Typed API client (20.0.0+) — покрывает getOrgStores/getMetrics (01-core.js)
 * и промокоды РТК (12-promos.js, 20.1.0): верный URL/метод/заголовки/тело,
 * проброс org_id-квери-параметра, throw на не-ok ответе с серверным
 * {error/message} вместо голого статус-кода (клиент сам не глотает ошибку
 * и не подставляет фолбэк — это остаётся задачей вызывающего кода, см.
 * api-client.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getOrgStores,
  getMetrics,
  getPromos,
  getPromoCard,
  createPromo,
  markPromoUsed,
  keepPromo
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
});
