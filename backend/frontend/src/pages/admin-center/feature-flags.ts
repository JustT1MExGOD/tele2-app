/**
 * Admin Control Center, Phase 4+ (Area B1) — Feature Flags. Plain
 * admin-CRUD, no reason/version/step-up (see api/routes/admin/
 * feature-flags.ts's header comment). One row per (key, org_id): a
 * global row (org_id null) shows as "все сети", an org-scoped row shows
 * its org id — the org override always wins at runtime, see
 * core/shared/feature-flags.ts's findEffective().
 */
import type { FeatureFlagRow } from '../../../../src/shared/api-types.js';

export function renderFeatureFlagsTab(container: HTMLElement): void {
  container.innerHTML = `
    <div class="section">
      <div class="section-title">Флаги функциональности</div>
      <div style="padding:0 16px 8px;display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="ffKey" placeholder="ключ (a-z, 0-9, _)" style="flex:1;min-width:140px">
        <input type="text" id="ffOrgId" placeholder="org_id (пусто = все сети)" style="flex:1;min-width:140px">
        <label style="display:flex;align-items:center;gap:4px;font-size:13px">
          <input type="checkbox" id="ffEnabled"> включено
        </label>
        <input type="text" id="ffDescription" placeholder="описание" style="flex:2;min-width:160px">
        <button type="button" class="btn-main" id="ffSaveBtn">Сохранить</button>
      </div>
      <div id="adminFeatureFlagsList"></div>
    </div>
  `;

  document.getElementById('ffSaveBtn')?.addEventListener('click', onSaveFlag);
  document.getElementById('adminFeatureFlagsList')?.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-delete-key]');
    if (btn?.dataset.deleteKey !== undefined) {
      onDeleteFlag(btn.dataset.deleteKey, btn.dataset.deleteOrg || null);
    }
  });

  loadFlags();
}

async function loadFlags(): Promise<void> {
  const box = document.getElementById('adminFeatureFlagsList');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.adminGetFeatureFlags(authHeaders());
    renderFlagsTable(box, res.items);
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить флаги</div>';
  }
}

function renderFlagsTable(box: HTMLElement, items: FeatureFlagRow[]): void {
  if (!items.length) {
    box.innerHTML = '<div class="empty">Флагов пока нет</div>';
    return;
  }
  box.innerHTML = items
    .map(
      (f) => `
      <div class="row" style="cursor:default">
        <div class="row-body">
          <div class="row-title">${esc(f.key)} · ${esc(f.org_id || 'все сети')} · ${f.enabled ? 'включено' : 'выключено'}</div>
          <div class="row-sub">${esc(f.description || '')}</div>
        </div>
        <button type="button" class="btn-ghost" data-delete-key="${esc(f.key)}" data-delete-org="${esc(f.org_id || '')}">Удалить</button>
      </div>`
    )
    .join('');
}

async function onSaveFlag(): Promise<void> {
  const key = (document.getElementById('ffKey') as HTMLInputElement | null)?.value.trim() || '';
  const orgId = (document.getElementById('ffOrgId') as HTMLInputElement | null)?.value.trim() || null;
  const enabled = (document.getElementById('ffEnabled') as HTMLInputElement | null)?.checked || false;
  const description = (document.getElementById('ffDescription') as HTMLInputElement | null)?.value.trim() || null;
  if (!key) {
    toast('Укажите ключ', 'err');
    return;
  }
  try {
    await window.apiClient.adminUpsertFeatureFlag(authHeaders(), key, orgId, enabled, description);
    toast('Флаг сохранён', 'ok');
    loadFlags();
  } catch (e) {
    toast('Ошибка сохранения флага', 'err');
  }
}

async function onDeleteFlag(key: string, orgId: string | null): Promise<void> {
  try {
    await window.apiClient.adminDeleteFeatureFlag(authHeaders(), key, orgId || null);
    toast('Флаг удалён', 'ok');
    loadFlags();
  } catch (e) {
    toast('Ошибка удаления флага', 'err');
  }
}
