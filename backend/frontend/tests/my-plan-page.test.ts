/**
 * 21.x (Frontend rewrite continuation, batch of 13) — jsdom render test for
 * frontend/js/05-my-plan.js → src/pages/my-plan. Focused rather than
 * exhaustive (batch migration) — covers the bind gate, profile/ring/month/
 * week/BFQ rendering, bindMe, and avatar file picker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals(overrides: { tgId?: number | null } = {}) {
  document.body.innerHTML = `
    <div id="myBindSection" style="display:none"></div>
    <div id="lkRoot" style="display:none">
      <div id="lkProfile"></div><div id="lkShift"></div><div id="lkInsight"></div>
      <div id="lkToday"></div><div id="lkMonth"></div><div id="lkWeek"></div>
      <div id="lkBfq"></div><div id="lkGamification"></div><div id="lkActions"></div>
      <div id="lkPhoneAuth"></div>
    </div>
    <div id="userAvatar"></div>
    <select id="bindEmployee"></select>
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
  `;
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('closeModal', vi.fn());
  vi.stubGlobal('me', null);
  vi.stubGlobal('tgUser', () => (overrides.tgId === null ? null : { id: overrides.tgId ?? 555, first_name: 'Иван', photo_url: '' }));
  vi.stubGlobal('todayMoscow', () => '2026-08-25');
  vi.stubGlobal('formatDateRu', (iso: string) => iso.split('-').reverse().join('.'));
  vi.stubGlobal('roleLabel', (r: string) => r);
  vi.stubGlobal('metricLabel', (id: string) => id.toUpperCase());
  vi.stubGlobal('progressHTML', (label: string, fact: unknown, plan: unknown) => `<div>${label}:${fact}/${plan}</div>`);
  vi.stubGlobal('storeColor', () => '#2aabee');
  vi.stubGlobal('pctTone', () => 'good');
  vi.stubGlobal('applyAvatarImg', vi.fn());
  vi.stubGlobal('employees', []);
  vi.stubGlobal('loadShiftAndInsight', vi.fn().mockResolvedValue(undefined));

  const getMe = vi.fn().mockResolvedValue({ bound: false, employee_id: null, full_name: null, role: null });
  const getEmployees = vi.fn().mockResolvedValue([]);
  const getMyDay = vi.fn().mockResolvedValue({ bound: true, shift: null, total: {} });
  const getEmployeeProgress = vi.fn().mockResolvedValue({ total: { fact: 0, plan: 0, percent: 0 } });
  const getScheduleMonth = vi.fn().mockResolvedValue({ month: '2026-08', start: '', end: '', items: [] });
  const getBfqList = vi.fn().mockResolvedValue({ month: '2026-08', items: [] });
  const getPlansEmployeesMonth = vi.fn().mockResolvedValue({ rows: [] });
  const bindMeApi = vi.fn().mockResolvedValue({ bound: true, employee_id: 1, full_name: 'Иван', role: 'employee' });
  const uploadAvatar = vi.fn().mockResolvedValue({ ok: true });
  const linkPhone = vi.fn().mockResolvedValue({ ok: true });
  (window as any).apiClient = { getMe, getEmployees, getMyDay, getEmployeeProgress, getScheduleMonth, getBfqList, getPlansEmployeesMonth, bindMe: bindMeApi, uploadAvatar, linkPhone };
  return { getMe, getEmployees, getMyDay, getEmployeeProgress, getScheduleMonth, getBfqList, getPlansEmployeesMonth, bindMeApi, uploadAvatar, linkPhone };
}

describe('Мой план (миграция frontend/js/05-my-plan.js → src/pages/my-plan)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('loadMyPlan: не привязан — показывает секцию привязки, скрывает lkRoot', async () => {
    setupGlobals();
    const { loadMyPlan } = await import('../src/pages/my-plan/index.js');
    await loadMyPlan();
    expect((document.getElementById('myBindSection') as HTMLElement).style.display).toBe('block');
    expect((document.getElementById('lkRoot') as HTMLElement).style.display).toBe('none');
  });

  it('loadMyPlan: привязан — рендерит профиль/действия, скрывает секцию привязки', async () => {
    const { getMe } = setupGlobals();
    getMe.mockResolvedValue({ bound: true, employee_id: 1, full_name: 'Иван Петров', role: 'employee' });
    const { loadMyPlan } = await import('../src/pages/my-plan/index.js');
    await loadMyPlan();
    expect((document.getElementById('myBindSection') as HTMLElement).style.display).toBe('none');
    const html = document.getElementById('lkProfile')!.innerHTML;
    expect(html).toContain('Иван Петров');
    expect(document.getElementById('lkActions')!.innerHTML).toContain('openAddSale(1)');
    expect((globalThis as any).loadShiftAndInsight).toHaveBeenCalledWith(1);
  });

  it('loadMyPlan: смена есть — рендерит кольцо и точку', async () => {
    const { getMe, getMyDay } = setupGlobals();
    getMe.mockResolvedValue({ bound: true, employee_id: 1, full_name: 'Иван', role: 'employee' });
    getMyDay.mockResolvedValue({ bound: true, shift: { store_id: 's1', store_name: 'Точка А', shift_text: 'День', hours: 8 }, total: { fact: 5, plan: 10, pct: 50 } });
    const { loadMyPlan } = await import('../src/pages/my-plan/index.js');
    await loadMyPlan();
    expect(document.getElementById('lkToday')!.innerHTML).toContain('Точка А');
    expect(document.getElementById('lkToday')!.innerHTML).toContain('50%');
  });

  it('loadMyPlan: месячный план сотрудника найден — рендерит группы метрик', async () => {
    const { getMe, getPlansEmployeesMonth } = setupGlobals();
    getMe.mockResolvedValue({ bound: true, employee_id: 1, full_name: 'Иван', role: 'employee' });
    getPlansEmployeesMonth.mockResolvedValue({ rows: [{ employee_id: 1, full_name: 'Иван', shifts: 10, remaining_shifts: 2, plan: { sim: 10 }, fact: { sim: 5 } }] });
    const { loadMyPlan } = await import('../src/pages/my-plan/index.js');
    await loadMyPlan();
    expect(document.getElementById('lkMonth')!.innerHTML).toContain('Блок GI');
  });

  it('loadMyPlan: BFQ — считает ранг из отсортированного списка', async () => {
    const { getMe, getBfqList } = setupGlobals();
    getMe.mockResolvedValue({ bound: true, employee_id: 1, full_name: 'Иван', role: 'employee' });
    getBfqList.mockResolvedValue({
      month: '2026-08',
      items: [
        { employee_id: 2, full_name: 'Пётр', total: 90 },
        { employee_id: 1, full_name: 'Иван', total: 70 }
      ]
    });
    const { loadMyPlan } = await import('../src/pages/my-plan/index.js');
    await loadMyPlan();
    expect(document.getElementById('lkBfq')!.innerHTML).toContain('#2 в сети');
  });

  it('bindMe: без Telegram id — toast err, API не вызывается', async () => {
    const { bindMeApi } = setupGlobals({ tgId: null });
    const { bindMe } = await import('../src/pages/my-plan/index.js');
    await bindMe();
    expect(bindMeApi).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Откройте из Telegram', 'err');
  });

  it('bindMe: успех — привязывает, тостит, перезагружает', async () => {
    const { bindMeApi, getMe } = setupGlobals();
    document.body.innerHTML += '';
    (document.getElementById('bindEmployee') as HTMLSelectElement).innerHTML = '<option value="1" selected></option>';
    const { bindMe } = await import('../src/pages/my-plan/index.js');
    await bindMe();
    expect(bindMeApi).toHaveBeenCalledWith(expect.anything(), { telegram_id: 555, employee_id: 1 });
    expect((globalThis as any).toast).toHaveBeenCalledWith('Привязано', 'ok');
    expect(getMe).toHaveBeenCalled(); // loadMyPlan() re-fetch
  });

  it('pickAvatarFile: создаёт скрытый file input один раз и переиспользует его', async () => {
    setupGlobals();
    const { pickAvatarFile } = await import('../src/pages/my-plan/index.js');
    pickAvatarFile();
    const input1 = document.getElementById('avatarFileInput');
    expect(input1).not.toBeNull();
    expect((input1 as HTMLInputElement).type).toBe('file');
    pickAvatarFile();
    const input2 = document.getElementById('avatarFileInput');
    expect(input2).toBe(input1);
  });

  it('window.* мост — все 5 функций', async () => {
    setupGlobals();
    await import('../src/pages/my-plan/index.js');
    for (const name of ['loadMyPlan', 'bindMe', 'pickAvatarFile', 'openLinkPhone', 'saveLinkPhone']) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });

  it('loadMyPlan: телефон ещё не привязан — рендерит кнопку привязки', async () => {
    const { getMe } = setupGlobals();
    getMe.mockResolvedValue({ bound: true, employee_id: 1, full_name: 'Иван', role: 'employee', phone: null });
    const { loadMyPlan } = await import('../src/pages/my-plan/index.js');
    await loadMyPlan();
    const html = document.getElementById('lkPhoneAuth')!.innerHTML;
    expect(html).toContain('openLinkPhone()');
    expect(html).toContain('Привязать телефон и пароль');
  });

  it('loadMyPlan: телефон уже привязан — показывает "Подключено", без кнопки', async () => {
    const { getMe } = setupGlobals();
    getMe.mockResolvedValue({ bound: true, employee_id: 1, full_name: 'Иван', role: 'employee', phone: '+79001234567' });
    const { loadMyPlan } = await import('../src/pages/my-plan/index.js');
    await loadMyPlan();
    const html = document.getElementById('lkPhoneAuth')!.innerHTML;
    expect(html).toContain('Подключено');
    expect(html).toContain('+79001234567');
    expect(html).not.toContain('openLinkPhone()');
  });

  it('openLinkPhone: открывает модалку с тремя полями', async () => {
    setupGlobals();
    const { openLinkPhone } = await import('../src/pages/my-plan/index.js');
    openLinkPhone();
    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(true);
    expect(document.getElementById('modalTitle')!.textContent).toBe('Вход с компьютера');
    expect(document.getElementById('linkPhoneInput')).not.toBeNull();
    expect(document.getElementById('linkPasswordInput')).not.toBeNull();
    expect(document.getElementById('linkPasswordConfirmInput')).not.toBeNull();
  });

  it('saveLinkPhone: короткий пароль — toast err, API не вызывается', async () => {
    const { linkPhone } = setupGlobals();
    const { openLinkPhone, saveLinkPhone } = await import('../src/pages/my-plan/index.js');
    openLinkPhone();
    (document.getElementById('linkPhoneInput') as HTMLInputElement).value = '+79001234567';
    (document.getElementById('linkPasswordInput') as HTMLInputElement).value = 'short';
    (document.getElementById('linkPasswordConfirmInput') as HTMLInputElement).value = 'short';
    await saveLinkPhone(null);
    expect(linkPhone).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Пароль должен быть от 8 символов', 'err');
  });

  it('saveLinkPhone: пароли не совпадают — toast err, API не вызывается', async () => {
    const { linkPhone } = setupGlobals();
    const { openLinkPhone, saveLinkPhone } = await import('../src/pages/my-plan/index.js');
    openLinkPhone();
    (document.getElementById('linkPhoneInput') as HTMLInputElement).value = '+79001234567';
    (document.getElementById('linkPasswordInput') as HTMLInputElement).value = 'password123';
    (document.getElementById('linkPasswordConfirmInput') as HTMLInputElement).value = 'password124';
    await saveLinkPhone(null);
    expect(linkPhone).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Пароли не совпадают', 'err');
  });

  it('saveLinkPhone: успех — вызывает API, тостит, закрывает модалку, перезагружает', async () => {
    const { linkPhone, getMe } = setupGlobals();
    const { openLinkPhone, saveLinkPhone } = await import('../src/pages/my-plan/index.js');
    openLinkPhone();
    (document.getElementById('linkPhoneInput') as HTMLInputElement).value = '+79001234567';
    (document.getElementById('linkPasswordInput') as HTMLInputElement).value = 'password123';
    (document.getElementById('linkPasswordConfirmInput') as HTMLInputElement).value = 'password123';
    await saveLinkPhone(null);
    expect(linkPhone).toHaveBeenCalledWith(expect.anything(), { phone: '+79001234567', password: 'password123' });
    expect((globalThis as any).toast).toHaveBeenCalledWith('Телефон привязан', 'ok');
    expect((globalThis as any).closeModal).toHaveBeenCalled();
    expect(getMe).toHaveBeenCalled(); // loadMyPlan() re-fetch
  });

  it('saveLinkPhone: ошибка API — toast err с сообщением сервера, модалка не закрывается', async () => {
    const { linkPhone } = setupGlobals();
    linkPhone.mockRejectedValue(new Error('Этот номер уже привязан к другому аккаунту'));
    const { openLinkPhone, saveLinkPhone } = await import('../src/pages/my-plan/index.js');
    openLinkPhone();
    (document.getElementById('linkPhoneInput') as HTMLInputElement).value = '+79001234567';
    (document.getElementById('linkPasswordInput') as HTMLInputElement).value = 'password123';
    (document.getElementById('linkPasswordConfirmInput') as HTMLInputElement).value = 'password123';
    await saveLinkPhone(null);
    expect((globalThis as any).toast).toHaveBeenCalledWith('Этот номер уже привязан к другому аккаунту', 'err');
    expect((globalThis as any).closeModal).not.toHaveBeenCalled();
  });
});
