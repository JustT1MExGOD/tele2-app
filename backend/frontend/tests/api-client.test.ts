/**
 * Typed API client (20.0.0) — покрывает getOrgStores/getMetrics: верный
 * URL/заголовки, проброс org_id-квери-параметра, throw на не-ok ответе
 * (клиент сам не глотает ошибку и не подставляет фолбэк — это остаётся
 * задачей вызывающего кода в 01-core.js, см. api-client.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrgStores, getMetrics } from '../src/api-client.js';

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
});
