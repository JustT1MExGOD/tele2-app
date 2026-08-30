/**
 * 21.x (Frontend rewrite continuation, batch of 13) — replacing
 * frontend/js/08-access-supervisor.js file-for-file: access gate (splash,
 * registration/pending/rejected screens, boot sequence), access-requests
 * approval UI, and the full supervisor cabinet (overview/stores/people/
 * trend). Security-sensitive — migrated with extra care for exact behavior
 * parity, no logic changes beyond typing.
 *
 * svBarRowHTML()/svExtraToggleHTML() already had ambient declarations in
 * legacy-globals.d.ts (attributed to this file, read by src/pages/plans-bfq)
 * — this is their real owner/implementation; declarations stay as-is, same
 * precedent as openModal/closeModal. bootApp() is called once at module load
 * (module-level side effect), matching the classic script's own trailing
 * `bootApp();` call.
 */
import type {
  AccessStatusResponse,
  AccessOrgsResponse,
  AccessDirectoryResponse,
  SubmitAccessRequestRequest,
  AccessRequestsListResponse,
  AdminTicketsSlaResponse,
  SupervisorDashboardResponse,
  MfaTotpEnrollment
} from '../../../../src/shared/api-types.js';

// ===== ACCESS GATE =====
// Скрывает сплэш загрузки. Вызывается из hideAccessGate() и
// showAccessGate() — это единственные две точки, которыми bootApp() (все 5
// его веток) завершает первый round-trip, поэтому сплэш гарантированно
// скрывается на любом исходе, включая ошибку сети.
function hideSplash(): void {
  const s = document.getElementById('appSplash');
  if (s) (s as HTMLElement).style.display = 'none';
}

// Desktop Shell (20.39) — та же логика, что btnAccessRequests/btnSupervisor/
// btnMgrTutorial ниже (el.style.display = canX() ? '' : 'none'), но на
// секции сайдбара целиком (заголовок+пункты одним блоком), не на
// отдельный пункт — иначе на десктопе видна пустая заголовок-строка без
// единого пункта под ней, если роль не проходит.
function gateSidebarSection(id: string, allowed: boolean): void {
  const el = document.getElementById(id);
  if (el) (el as HTMLElement).style.display = allowed ? '' : 'none';
}

// 20.40.2 — вынесено в общую функцию: раньше жило инлайн только в
// Telegram-ветке bootApp() (ниже), не-Telegram ветка (20.37, не-Telegram
// вход) делала early return через enterHomeOrSupervisorShell() до этого
// кода — те же секции сайдбара/кнопки навсегда оставались на дефолтном
// display:none из HTML для ЛЮБОГО desktop/phone-login пользователя,
// независимо от реальной роли (админ на десктопе видел только "Обзор").
// Тот же класс бага, что уже чинили в loadMyDay() (tgUser()-only гейт,
// протухший с 20.35+ multi-provider auth) — просто на другом экране.
function applyRoleGatedNav(): void {
  const btnAcc = document.getElementById('btnAccessRequests') as HTMLElement | null;
  const btnSv = document.getElementById('btnSupervisor') as HTMLElement | null;
  if (btnAcc) btnAcc.style.display = canApprove() ? '' : 'none';
  if (btnSv) btnSv.style.display = canAdmin() ? '' : 'none';
  const btnMgrTut = document.getElementById('btnMgrTutorial') as HTMLElement | null;
  if (btnMgrTut) btnMgrTut.style.display = canManage() ? '' : 'none';

  gateSidebarSection('sidebarSectionAnalytics', canViewAnalytics());
  gateSidebarSection('sidebarSectionManage', canManage());
  gateSidebarSection('sidebarSectionSupervisor', isSupervisor() || canAdmin());
  gateSidebarSection('sidebarSectionAdmin', canAdmin());
}

export function showAccessGate(st: { status?: string; user?: any }): void {
  hideSplash();
  const gate = document.getElementById('accessGate') as HTMLElement | null;
  const body = document.getElementById('gateBody');
  const sub = document.getElementById('gateSubtitle');
  if (!gate || !body) {
    console.error('accessGate DOM missing');
    return;
  }
  // Gate всегда fixed поверх всего (вне .sheet)
  gate.style.cssText = 'display:block;position:fixed;inset:0;z-index:9999;background:var(--bg,#0a0a0b);overflow:auto;-webkit-overflow-scrolling:touch;visibility:visible;opacity:1;pointer-events:auto';
  const sheet = document.querySelector('.sheet') as HTMLElement | null;
  if (sheet) {
    sheet.style.visibility = 'hidden';
    sheet.style.pointerEvents = 'none';
  }
  const hdr = document.querySelector('.app-header') as HTMLElement | null;
  if (hdr) hdr.style.visibility = 'hidden';
  const nav = document.querySelector('.bottom-nav') as HTMLElement | null;
  if (nav) nav.style.display = 'none';
  const fab = document.querySelector('.fab') as HTMLElement | null;
  if (fab) fab.style.display = 'none';

  const status = st.status || st.user?.access_status || 'none';
  const tgName = [tgUser()?.first_name, tgUser()?.last_name].filter(Boolean).join(' ').trim();
  const tid = tgUser()?.id || '—';

  if (status === 'pending') {
    if (sub) sub.textContent = 'Заявка на проверке';
    body.innerHTML = `
          <div class="gate-card">
            <div class="bind-glow"></div>
            <div class="gate-icon warn">⏳</div>
            <div class="gate-title">Ожидайте подтверждения</div>
            <div class="gate-desc">
              Manager или супервайзер подтвердит, что вы сотрудник сети.
              Обычно это несколько минут.
            </div>
            <button class="btn-main" onclick="bootApp()">Обновить статус</button>
          </div>`;
    return;
  }

  if (status === 'rejected' || status === 'blocked') {
    if (sub) sub.textContent = 'Доступ закрыт';
    body.innerHTML = `
          <div class="gate-card">
            <div class="bind-glow"></div>
            <div class="gate-icon danger"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" /> </svg></div>
            <div class="gate-title">В доступе отказано</div>
            <div class="gate-desc">
              Напиши управляющему или admin.
              Если ошибка — пусть выставят access_status = active.
            </div>
            <div class="bind-foot" style="position:relative;margin-bottom:12px">Telegram ID: <code>${tid}</code></div>
            <button class="btn-main" onclick="bootApp()">Проверить снова</button>
            <button class="btn-ghost" onclick="showAccessGate({status:'none'})">Подать заявку заново</button>
          </div>`;
    return;
  }

  // none — форма регистрации
  if (sub) sub.textContent = 'Регистрация · один раз';
  body.innerHTML = `
        <div class="gate-card">
          <div class="bind-glow"></div>
          <div class="gate-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" /> <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" /> <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" /> <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /> </svg></div>
          <div class="gate-title">Добро пожаловать</div>
          <div class="gate-desc">
            Укажи ФИО как в команде. После подтверждения manager откроется полный доступ к плану, сменам и продажам.
          </div>
          <div class="field" id="gateOrgField">
            <label>Сеть</label>
            <select id="gateOrg"><option value="" disabled selected>— выбери сеть —</option></select>
            <div class="bind-foot" id="gateOrgHint" style="display:none;margin-top:6px">Сеть определится по выбранному сотруднику</div>
          </div>
          <div class="field">
            <label>ФИО</label>
            <input id="gateName" placeholder="Иванов Иван Иванович" value="${(tgName || '').replace(/"/g, '&quot;')}">
          </div>
          <div class="field">
            <label>Комментарий</label>
            <input id="gateMsg" placeholder="Точка / с какого числа">
          </div>
          <div class="field">
            <label>Я из списка</label>
            <select id="gateClaim" onchange="onGateClaimChange()"><option value="">— новый сотрудник —</option></select>
          </div>
          <button class="btn-main" style="margin-top:8px" onclick="submitAccessRequest()">Отправить заявку</button>
          <div class="bind-foot" style="position:relative;margin-top:14px">ID: ${tid} · T2 Sales ${typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''}</div>
        </div>`;
  loadGateOrgs();
}

function hideAccessGate(): void {
  hideSplash();
  const gate = document.getElementById('accessGate') as HTMLElement | null;
  if (gate) gate.style.display = 'none';
  const sheet = document.querySelector('.sheet') as HTMLElement | null;
  if (sheet) {
    sheet.style.visibility = 'visible';
    sheet.style.pointerEvents = '';
  }
  const hdr = document.querySelector('.app-header') as HTMLElement | null;
  if (hdr) hdr.style.visibility = '';
  const nav = document.querySelector('.bottom-nav') as HTMLElement | null;
  if (nav) nav.style.display = '';
  const fab = document.querySelector('.fab') as HTMLElement | null;
  if (fab) fab.style.display = 'flex';
}

// Список сетей для пикера — единственный вариант автовыбирается и прячется
// (нет смысла выбирать из одного). При выборе сети — только тогда
// подгружается claim-список, отфильтрованный по ней (без выбранной сети
// список не грузим вообще, иначе гость сети B опять мог бы «заклеймить»
// сотрудника сети A).
async function loadGateOrgs(): Promise<void> {
  try {
    const list: AccessOrgsResponse = await window.apiClient.getAccessOrgs(authHeaders());
    const sel = document.getElementById('gateOrg') as HTMLSelectElement | null;
    const field = document.getElementById('gateOrgField');
    if (!sel) return;
    const orgs = Array.isArray(list) ? list : [];
    orgs.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.name;
      sel.appendChild(opt);
    });
    if (orgs.length <= 1) {
      if (orgs.length === 1) sel.value = orgs[0].id;
      if (field) (field as HTMLElement).style.display = 'none';
      loadGateDirectory(sel.value);
    } else {
      sel.onchange = () => loadGateDirectory(sel.value);
    }
  } catch (_) {}
}

async function loadGateDirectory(orgId?: string): Promise<void> {
  try {
    const orgParam = orgId ? '?org_id=' + encodeURIComponent(orgId) : '';
    const list: AccessDirectoryResponse = await window.apiClient.getAccessDirectory(authHeaders(), orgParam);
    const sel = document.getElementById('gateClaim') as HTMLSelectElement | null;
    if (!sel) return;
    sel.innerHTML = '<option value="">— новый сотрудник —</option>';
    (Array.isArray(list) ? list : []).forEach((e) => {
      const o = document.createElement('option');
      o.value = String(e.id);
      o.textContent = e.full_name;
      sel.appendChild(o);
    });
  } catch (_) {}
}

// Claim выбран — сеть сотрудника уже известна сама по себе, пикер
// блокируется, чтобы не путать (выбор сети никак не влияет на claim).
export function onGateClaimChange(): void {
  const claim = (document.getElementById('gateClaim') as HTMLSelectElement | null)?.value;
  const orgSel = document.getElementById('gateOrg') as HTMLSelectElement | null;
  const hint = document.getElementById('gateOrgHint') as HTMLElement | null;
  if (orgSel) orgSel.disabled = !!claim;
  if (hint) hint.style.display = claim ? 'block' : 'none';
}

export async function submitAccessRequest(): Promise<void> {
  const full_name = (document.getElementById('gateName') as HTMLInputElement | null)?.value?.trim();
  if (!full_name || full_name.length < 3) {
    toast('Укажите ФИО', 'err');
    return;
  }
  const claimed = (document.getElementById('gateClaim') as HTMLSelectElement | null)?.value;
  const orgVal = (document.getElementById('gateOrg') as HTMLSelectElement | null)?.value;
  if (!claimed && !orgVal) {
    toast('Выберите сеть', 'err');
    return;
  }
  const body: SubmitAccessRequestRequest = {
    full_name,
    message: (document.getElementById('gateMsg') as HTMLInputElement | null)?.value || '',
    username: tgUser()?.username || null,
    claimed_employee_id: claimed ? Number(claimed) : null,
    org_id: claimed ? null : orgVal || null
  };
  try {
    await window.apiClient.submitAccessRequest(authHeaders(true), body);
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    return;
  }
  toast('Заявка отправлена', 'ok');
  showAccessGate({ status: 'pending' });
}

// ===== НЕ-TELEGRAM ВХОД (20.37) =====
// Тот же overlay-механизм, что accessGate выше (единственный экран "ты ещё
// не внутри приложения") — не отдельная .page: до входа бессмысленно
// показывать header/bottom-nav, которые .page-система предполагает как
// данность. login/register переиспользуют gateOrg/gateClaim/loadGateOrgs()
// — тот же пикер сети/карточки, что уже есть у Telegram-регистрации, он
// не Telegram-специфичен сам по себе.
const LOCK_ICON =
  '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" /> </svg>';

export function showLoginGate(mode: 'login' | 'register' | 'reset' = 'login'): void {
  hideSplash();
  const gate = document.getElementById('accessGate') as HTMLElement | null;
  const body = document.getElementById('gateBody');
  const sub = document.getElementById('gateSubtitle');
  if (!gate || !body) {
    console.error('accessGate DOM missing');
    return;
  }
  gate.style.cssText =
    'display:block;position:fixed;inset:0;z-index:9999;background:var(--bg,#0a0a0b);overflow:auto;-webkit-overflow-scrolling:touch;visibility:visible;opacity:1;pointer-events:auto';
  const sheet = document.querySelector('.sheet') as HTMLElement | null;
  if (sheet) {
    sheet.style.visibility = 'hidden';
    sheet.style.pointerEvents = 'none';
  }
  const hdr = document.querySelector('.app-header') as HTMLElement | null;
  if (hdr) hdr.style.visibility = 'hidden';
  const nav = document.querySelector('.bottom-nav') as HTMLElement | null;
  if (nav) nav.style.display = 'none';
  const fab = document.querySelector('.fab') as HTMLElement | null;
  if (fab) fab.style.display = 'none';

  if (mode === 'reset') {
    if (sub) sub.textContent = 'Новый пароль';
    body.innerHTML = `
          <div class="gate-card">
            <div class="bind-glow"></div>
            <div class="gate-icon">${LOCK_ICON}</div>
            <div class="gate-title">Придумайте новый пароль</div>
            <div class="field"><label>Новый пароль</label><input id="loginPassword" type="password" placeholder="Минимум 8 символов" autocomplete="new-password"></div>
            <div class="field"><label>Повторите пароль</label><input id="loginPasswordConfirm" type="password" autocomplete="new-password"></div>
            <button class="btn-main" style="margin-top:8px" onclick="submitPasswordReset()">Сохранить и войти</button>
          </div>`;
    return;
  }

  if (mode === 'register') {
    if (sub) sub.textContent = 'Регистрация · телефон';
    body.innerHTML = `
          <div class="gate-card">
            <div class="bind-glow"></div>
            <div class="gate-icon">${LOCK_ICON}</div>
            <div class="gate-title">Вход без Telegram</div>
            <div class="gate-desc">
              Укажи телефон, пароль и ФИО — manager подтвердит доступ, так же
              как при регистрации через Telegram.
            </div>
            <div class="field" id="gateOrgField">
              <label>Сеть</label>
              <select id="gateOrg"><option value="" disabled selected>— выбери сеть —</option></select>
              <div class="bind-foot" id="gateOrgHint" style="display:none;margin-top:6px">Сеть определится по выбранному сотруднику</div>
            </div>
            <div class="field"><label>ФИО</label><input id="loginFullName" placeholder="Иванов Иван Иванович"></div>
            <div class="field"><label>Телефон</label><input id="loginPhone" type="tel" placeholder="+79001234567" autocomplete="tel"></div>
            <div class="field"><label>Пароль</label><input id="loginPassword" type="password" placeholder="Минимум 8 символов" autocomplete="new-password"></div>
            <div class="field"><label>Повторите пароль</label><input id="loginPasswordConfirm" type="password" autocomplete="new-password"></div>
            <div class="field">
              <label>Я из списка</label>
              <select id="gateClaim" onchange="onGateClaimChange()"><option value="">— новый сотрудник —</option></select>
            </div>
            <button class="btn-main" style="margin-top:8px" onclick="submitPhoneRegister()">Отправить заявку</button>
            <div class="bind-foot" style="position:relative;margin-top:14px">Уже есть телефон и пароль? <a href="javascript:void(0)" onclick="showLoginGate('login')">Войти</a></div>
          </div>`;
    loadGateOrgs();
    return;
  }

  if (sub) sub.textContent = 'Вход без Telegram';
  body.innerHTML = `
        <div class="gate-card">
          <div class="bind-glow"></div>
          <div class="gate-icon">${LOCK_ICON}</div>
          <div class="gate-title">Вход с телефоном и паролем</div>
          <div class="gate-desc">
            Для тех, у кого нет доступа к Telegram — пароль привязывается в
            профиле («Мой план» → «Вход с компьютера») или через регистрацию ниже.
          </div>
          <div class="field"><label>Телефон</label><input id="loginPhone" type="tel" placeholder="+79001234567" autocomplete="tel"></div>
          <div class="field"><label>Пароль</label><input id="loginPassword" type="password" autocomplete="current-password"></div>
          <button class="btn-main" style="margin-top:8px" onclick="submitPhoneLogin()">Войти</button>
          <div class="bind-foot" style="position:relative;margin-top:14px">Ещё нет доступа? <a href="javascript:void(0)" onclick="showLoginGate('register')">Зарегистрироваться</a></div>
        </div>`;
}

export async function submitPhoneLogin(): Promise<void> {
  const phone = (document.getElementById('loginPhone') as HTMLInputElement | null)?.value?.trim() || '';
  const password = (document.getElementById('loginPassword') as HTMLInputElement | null)?.value || '';
  if (!phone || !password) {
    toast('Заполните телефон и пароль', 'err');
    return;
  }
  let res;
  try {
    res = await window.apiClient.loginPhone(authHeaders(true), { phone, password });
  } catch (e: any) {
    toast(e?.message || 'Неверный телефон или пароль', 'err');
    return;
  }
  // 20.52.1 — пароль подтверждён, но у аккаунта настроен второй фактор:
  // сессии ещё нет (см. auth/api/routes/auth/session.ts), нужен MFA-код.
  if (res.mfa_required && res.mfa_token) {
    showMfaLoginChallenge(res.mfa_token, res.mfa_methods || []);
    return;
  }
  toast('Вход выполнен', 'ok');
  bootApp();
}

export async function submitPhoneRegister(): Promise<void> {
  const full_name = (document.getElementById('loginFullName') as HTMLInputElement | null)?.value?.trim() || '';
  if (!full_name || full_name.length < 3) {
    toast('Укажите ФИО', 'err');
    return;
  }
  const phone = (document.getElementById('loginPhone') as HTMLInputElement | null)?.value?.trim() || '';
  const password = (document.getElementById('loginPassword') as HTMLInputElement | null)?.value || '';
  const confirm = (document.getElementById('loginPasswordConfirm') as HTMLInputElement | null)?.value || '';
  if (password.length < 8) {
    toast('Пароль должен быть от 8 символов', 'err');
    return;
  }
  if (password !== confirm) {
    toast('Пароли не совпадают', 'err');
    return;
  }
  const claimed = (document.getElementById('gateClaim') as HTMLSelectElement | null)?.value;
  const orgVal = (document.getElementById('gateOrg') as HTMLSelectElement | null)?.value;
  if (!claimed && !orgVal) {
    toast('Выберите сеть', 'err');
    return;
  }
  try {
    await window.apiClient.registerPhone(authHeaders(true), {
      phone,
      password,
      full_name,
      claimed_employee_id: claimed ? Number(claimed) : null,
      org_id: claimed ? null : orgVal || null
    });
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    return;
  }
  toast('Заявка отправлена', 'ok');
  showAccessGate({ status: 'pending' });
}

export async function submitPasswordReset(): Promise<void> {
  const password = (document.getElementById('loginPassword') as HTMLInputElement | null)?.value || '';
  const confirm = (document.getElementById('loginPasswordConfirm') as HTMLInputElement | null)?.value || '';
  if (password.length < 8) {
    toast('Пароль должен быть от 8 символов', 'err');
    return;
  }
  if (password !== confirm) {
    toast('Пароли не совпадают', 'err');
    return;
  }
  const token = new URLSearchParams(location.search).get('reset') || '';
  if (!token) {
    toast('Ссылка недействительна', 'err');
    return;
  }
  let res;
  try {
    res = await window.apiClient.consumePasswordReset(authHeaders(true), token, { password });
  } catch (e: any) {
    toast(e?.message || 'Ссылка недействительна или уже использована', 'err');
    return;
  }
  history.replaceState(null, '', location.pathname);
  // §4/RESET-1 (20.52.1) — сброс пароля для аккаунта с настроенным MFA
  // больше не выдаёт сессию сразу, см. api/routes/auth/session.ts.
  if (res.mfa_required && res.mfa_token) {
    showMfaLoginChallenge(res.mfa_token, res.mfa_methods || []);
    return;
  }
  toast('Пароль обновлён', 'ok');
  bootApp();
}

// ===== MFA (20.52.1, Auth Assurance Hardening) =====
// Минимальный, но реально работающий UX: TOTP как основной path (не
// требует WebAuthn browser API/ceremony-кода — тот путь сознательно
// отложен, см. docs/ADR/009-mfa-step-up.md, "20.52.1 revision"). Без
// этого экрана backend-политика "privileged без MFA не проходит дальше
// enrollment-роутов" (auth/guards.ts) заблокировала бы вообще ВСЕХ
// сегодняшних admin/supervisor — ни один ещё не настроил MFA.
let mfaLoginToken: string | null = null;
let mfaEnrollSecret: string | null = null;

export function showMfaLoginChallenge(mfaToken: string, methods: string[]): void {
  hideSplash();
  mfaLoginToken = mfaToken;
  const gate = document.getElementById('accessGate') as HTMLElement | null;
  const body = document.getElementById('gateBody');
  const sub = document.getElementById('gateSubtitle');
  if (!gate || !body) return;
  gate.style.cssText =
    'display:block;position:fixed;inset:0;z-index:9999;background:var(--bg,#0a0a0b);overflow:auto;-webkit-overflow-scrolling:touch;visibility:visible;opacity:1;pointer-events:auto';
  const sheet = document.querySelector('.sheet') as HTMLElement | null;
  if (sheet) {
    sheet.style.visibility = 'hidden';
    sheet.style.pointerEvents = 'none';
  }
  if (sub) sub.textContent = 'Подтверждение входа';
  const hasRecovery = methods.includes('recovery_code');
  body.innerHTML = `
        <div class="gate-card">
          <div class="bind-glow"></div>
          <div class="gate-icon">${LOCK_ICON}</div>
          <div class="gate-title">Код из приложения-аутентификатора</div>
          <div class="gate-desc">Введите 6-значный код из TOTP-приложения (Google Authenticator, 1Password и т.п.)${hasRecovery ? ', либо один из recovery-кодов' : ''}.</div>
          <div class="field">
            <label>Код</label>
            <input id="mfaLoginCode" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="20">
          </div>
          <button class="btn-main" style="margin-top:8px" onclick="submitMfaLoginCode()">Подтвердить</button>
        </div>`;
  const input = document.getElementById('mfaLoginCode') as HTMLInputElement | null;
  input?.focus();
}

export async function submitMfaLoginCode(): Promise<void> {
  const raw = (document.getElementById('mfaLoginCode') as HTMLInputElement | null)?.value?.trim() || '';
  if (!raw) {
    toast('Введите код', 'err');
    return;
  }
  if (!mfaLoginToken) {
    toast('Сессия входа истекла, начните заново', 'err');
    showLoginGate('login');
    return;
  }
  // recovery-коды в этом проекте — "xxxx-xxxx-xxxx-xxxx-xxxx" (с дефисами,
  // 20+ символов); всё остальное — TOTP-код.
  const method = raw.length > 8 || raw.includes('-') ? 'recovery_code' : 'totp';
  try {
    await window.apiClient.loginMfa(authHeaders(true), { mfa_token: mfaLoginToken, method, code: raw });
  } catch (e: any) {
    toast(e?.message || 'Неверный код', 'err');
    return;
  }
  mfaLoginToken = null;
  toast('Вход выполнен', 'ok');
  bootApp();
}

/** Показывается вместо обычной оболочки, когда GET /me вернул
 * mfa_enrollment_required:true — backend уже физически блокирует все
 * остальные защищённые роуты в этом состоянии (auth/guards.ts), этот
 * экран — единственный способ пройти дальше. */
export function showMfaEnrollmentGate(): void {
  hideSplash();
  const gate = document.getElementById('accessGate') as HTMLElement | null;
  const body = document.getElementById('gateBody');
  const sub = document.getElementById('gateSubtitle');
  if (!gate || !body) return;
  gate.style.cssText =
    'display:block;position:fixed;inset:0;z-index:9999;background:var(--bg,#0a0a0b);overflow:auto;-webkit-overflow-scrolling:touch;visibility:visible;opacity:1;pointer-events:auto';
  const sheet = document.querySelector('.sheet') as HTMLElement | null;
  if (sheet) {
    sheet.style.visibility = 'hidden';
    sheet.style.pointerEvents = 'none';
  }
  if (sub) sub.textContent = 'Нужна настройка MFA';
  body.innerHTML = `
        <div class="gate-card">
          <div class="bind-glow"></div>
          <div class="gate-icon">${LOCK_ICON}</div>
          <div class="gate-title">Для вашей роли обязателен второй фактор</div>
          <div class="gate-desc">
            Управляющие сетью и супервайзеры обязаны подключить
            подтверждение входа (MFA) — это защищает от входа по одному
            украденному паролю. Отсканируйте QR-код приложением-
            аутентификатором (Google Authenticator, 1Password и т.п.) и
            введите код, чтобы продолжить.
          </div>
          <button class="btn-main" style="margin-top:8px" onclick="submitMfaTotpEnrollStart()">Начать настройку</button>
          <div class="bind-foot" style="position:relative;margin-top:14px"><a href="javascript:void(0)" onclick="logoutFromMfaGate()">Выйти</a></div>
        </div>`;
}

export async function submitMfaTotpEnrollStart(): Promise<void> {
  let enrollment: MfaTotpEnrollment;
  try {
    enrollment = await window.apiClient.mfaTotpEnroll(authHeaders(true));
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    return;
  }
  mfaEnrollSecret = enrollment.secret;
  const body = document.getElementById('gateBody');
  if (!body) return;
  body.innerHTML = `
        <div class="gate-card">
          <div class="bind-glow"></div>
          <div class="gate-title">Отсканируйте QR-код</div>
          <div class="gate-desc">Или введите секрет вручную: <code style="user-select:all">${esc(enrollment.secret)}</code></div>
          <img src="${enrollment.qrCodeDataUrl}" alt="QR" style="display:block;margin:12px auto;width:200px;height:200px;border-radius:12px">
          <div class="field">
            <label>Код из приложения</label>
            <input id="mfaEnrollCode" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="8">
          </div>
          <button class="btn-main" style="margin-top:8px" onclick="submitMfaTotpConfirmCode()">Подтвердить</button>
        </div>`;
  (document.getElementById('mfaEnrollCode') as HTMLInputElement | null)?.focus();
}

export async function submitMfaTotpConfirmCode(): Promise<void> {
  const code = (document.getElementById('mfaEnrollCode') as HTMLInputElement | null)?.value?.trim() || '';
  if (!code) {
    toast('Введите код', 'err');
    return;
  }
  try {
    await window.apiClient.mfaTotpConfirm(authHeaders(true), code);
  } catch (e: any) {
    toast(e?.message || 'Неверный код — попробуйте ещё раз', 'err');
    return;
  }
  mfaEnrollSecret = null;
  let codes: string[] = [];
  try {
    const res = await window.apiClient.mfaRecoveryCodesGenerate(authHeaders(true));
    codes = res.codes;
  } catch (_) {
    // TOTP уже подтверждён и это главное — recovery-коды всегда можно
    // сгенерировать позже из профиля; не блокируем вход из-за этого шага.
  }
  const body = document.getElementById('gateBody');
  if (!body) {
    bootApp();
    return;
  }
  if (!codes.length) {
    toast('MFA настроен', 'ok');
    bootApp();
    return;
  }
  body.innerHTML = `
        <div class="gate-card">
          <div class="bind-glow"></div>
          <div class="gate-title">Сохраните резервные коды</div>
          <div class="gate-desc">Каждый код работает один раз — используйте, если потеряете доступ к приложению-аутентификатору. Сейчас они показаны единственный раз.</div>
          <div style="font-family:monospace;font-size:14px;line-height:1.8;background:var(--card,#161618);border-radius:12px;padding:12px;margin:12px 0;user-select:all">
            ${codes.map((c) => esc(c)).join('<br>')}
          </div>
          <button class="btn-main" onclick="ackMfaRecoveryCodesSaved()">Я сохранил(а) коды</button>
        </div>`;
}

export function ackMfaRecoveryCodesSaved(): void {
  toast('MFA настроен', 'ok');
  bootApp();
}

export async function logoutFromMfaGate(): Promise<void> {
  // §P1-G (20.54.0) — best-effort flush while the session is still
  // valid, then unconditionally wipe anything left over: a shared
  // device's next login must never auto-replay this identity's queued
  // offline sales. See frontend/offline-queue.js::clear() for why.
  try {
    await (window as any).OfflineQueue?.flush?.();
  } catch (_) {}
  try {
    await (window as any).OfflineQueue?.clear?.();
  } catch (_) {}
  try {
    await window.apiClient.logoutPhone(authHeaders(true));
  } catch (_) {}
  location.reload();
}

// ===== Telegram AAL2 reverification (20.53.0) =====
// Показывается вместо обычной оболочки, когда GET /me вернул
// mfa_reverification_required:true — фактор на аккаунте уже настроен,
// но ЭТОТ конкретный Telegram-контекст (Mini App-сессия) его ещё не
// подтверждал (нет initData-эквивалента "логина", см.
// auth/mfa/telegram-grant.ts) — лёгкий одноразовый экран, не полный
// enrollment (QR/recovery-коды здесь не нужны, фактор уже есть).
export function showMfaTelegramReverifyGate(): void {
  hideSplash();
  const gate = document.getElementById('accessGate') as HTMLElement | null;
  const body = document.getElementById('gateBody');
  const sub = document.getElementById('gateSubtitle');
  if (!gate || !body) return;
  gate.style.cssText =
    'display:block;position:fixed;inset:0;z-index:9999;background:var(--bg,#0a0a0b);overflow:auto;-webkit-overflow-scrolling:touch;visibility:visible;opacity:1;pointer-events:auto';
  const sheet = document.querySelector('.sheet') as HTMLElement | null;
  if (sheet) {
    sheet.style.visibility = 'hidden';
    sheet.style.pointerEvents = 'none';
  }
  if (sub) sub.textContent = 'Подтверждение MFA';
  body.innerHTML = `
        <div class="gate-card">
          <div class="bind-glow"></div>
          <div class="gate-icon">${LOCK_ICON}</div>
          <div class="gate-title">Подтвердите вход</div>
          <div class="gate-desc">Для вашей роли требуется подтверждение второго фактора в этом сеансе Mini App. Введите код из приложения-аутентификатора или один из recovery-кодов.</div>
          <div class="field">
            <label>Код</label>
            <input id="mfaTgReverifyCode" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="20">
          </div>
          <button class="btn-main" style="margin-top:8px" onclick="submitMfaTelegramReverifyCode()">Подтвердить</button>
        </div>`;
  (document.getElementById('mfaTgReverifyCode') as HTMLInputElement | null)?.focus();
}

export async function submitMfaTelegramReverifyCode(): Promise<void> {
  const raw = (document.getElementById('mfaTgReverifyCode') as HTMLInputElement | null)?.value?.trim() || '';
  if (!raw) {
    toast('Введите код', 'err');
    return;
  }
  const method = raw.length > 8 || raw.includes('-') ? 'recovery_code' : 'totp';
  try {
    await window.apiClient.mfaTelegramVerify(authHeaders(true), { method, code: raw });
  } catch (e: any) {
    toast(e?.message || 'Неверный код', 'err');
    return;
  }
  toast('Подтверждено', 'ok');
  bootApp();
}

export async function bootApp(): Promise<void> {
  applyTheme(localStorage.getItem('t2_theme') || 'light');
  const dateEl = document.getElementById('headerDate');
  if (dateEl) dateEl.textContent = formatDateRu(todayMoscow());

  const user = tgUser();
  if (!user?.id) {
    // Не-Telegram вход (20.37) — раньше здесь был безусловный пропуск "для
    // отладки", последний пробел, который ADR-005/20.35-20.36 оставляли
    // открытым: снаружи Telegram можно было зайти в пустую оболочку с
    // me=null, но никак не ввести телефон+пароль. Теперь: сначала пробуем
    // уже существующую cookie-сессию (после /auth/login или /me/link-phone
    // в другой вкладке/раньше), и только если её нет — показываем логин
    // вместо молчаливого входа вслепую.
    //
    // ?reset=<token> в URL — сразу экран смены пароля, минуя логин: сама
    // ссылка уже секрет (см. POST /auth/admin/reset-password), доказывать
    // личность паролем, который как раз меняется, не нужно.
    const resetToken = new URLSearchParams(location.search).get('reset');
    if (resetToken) {
      if (typeof applyBranding === 'function') applyBranding();
      showLoginGate('reset');
      return;
    }

    try {
      me = await window.apiClient.getMe(authHeaders());
    } catch (_) {
      me = null;
    }
    if (me?.bound) {
      hideAccessGate();
      if (typeof applyBranding === 'function') applyBranding();
      // 20.52.1 — backend уже физически блокирует все остальные защищённые
      // роуты в этом состоянии (auth/guards.ts); этот экран — единственный
      // путь дальше для privileged-аккаунта без MFA.
      if (me?.mfa_enrollment_required) {
        showMfaEnrollmentGate();
        return;
      }
      // 20.53.0 — фактор настроен, но этот Telegram-контекст его ещё не
      // подтверждал (auth/mfa/telegram-grant.ts) — лёгкий re-verify,
      // не полный enrollment.
      if (me?.mfa_reverification_required) {
        showMfaTelegramReverifyGate();
        return;
      }
      applyRoleGatedNav();
      enterHomeOrSupervisorShell();
      return;
    }

    if (typeof applyBranding === 'function') applyBranding();
    showLoginGate('login');
    return;
  }

  try {
    const res = await fetch(API + '/access/status', { headers: authHeaders() });

    // Если роута ещё нет (404) — не блокируем, пускаем через /me
    if (res.status === 404) {
      console.warn('/access/status not found — skip gate');
      try {
        me = await window.apiClient.getMe(authHeaders());
      } catch (_) {}
      hideAccessGate();
      if (me?.mfa_enrollment_required) {
        showMfaEnrollmentGate();
        return;
      }
      // 20.53.0 — фактор настроен, но этот Telegram-контекст его ещё не
      // подтверждал (auth/mfa/telegram-grant.ts) — лёгкий re-verify,
      // не полный enrollment.
      if (me?.mfa_reverification_required) {
        showMfaTelegramReverifyGate();
        return;
      }
      applyRoleGatedNav();
      enterHomeOrSupervisorShell();
      maybeOfferTutorial();
      return;
    }

    const st: AccessStatusResponse = await res.json().catch(() => ({}) as AccessStatusResponse);
    const status = st.status === 'active' || (st.user as any)?.access_status === 'active' ? 'active' : st.status || (st.user as any)?.access_status || 'none';

    if (status === 'anonymous' || status === 'none' || status === 'pending' || status === 'rejected' || status === 'blocked') {
      // anonymous без telegram — уже обработан выше
      if (status !== 'anonymous') {
        showAccessGate(st);
        return;
      }
    }

    me = (st.user as any) || me;
    try {
      const m = await window.apiClient.getMe(authHeaders());
      me = { ...me, ...m };
    } catch (_) {}

    hideAccessGate();
    // «Кабинет супервайзера» (btnSupervisor) — теперь только явная кнопка
    // для admin (canAdmin(), не canViewAnalytics()); manager/senior её
    // больше не видят вообще — кабинет изолирован от них, у admin это
    // осознанный «заглянуть», а не дефолтный вид. Гейтинг самой кнопки и
    // секций сайдбара — общая функция applyRoleGatedNav() (см. выше);
    // 20.40.2 — раньше жила только здесь инлайн, не-Telegram/404/catch
    // ветки ниже её не вызывали вообще.
    if (me?.mfa_enrollment_required) {
      showMfaEnrollmentGate();
      return;
    }
    if (me?.mfa_reverification_required) {
      showMfaTelegramReverifyGate();
      return;
    }
    applyRoleGatedNav();

    enterHomeOrSupervisorShell();
    maybeOfferTutorial();
  } catch (e) {
    console.error(e);
    // сеть/парс — не запираем в gate навечно
    try {
      me = await window.apiClient.getMe(authHeaders());
    } catch (_) {}
    hideAccessGate();
    if (me?.mfa_enrollment_required) {
      showMfaEnrollmentGate();
      return;
    }
    if (me?.mfa_reverification_required) {
      showMfaTelegramReverifyGate();
      return;
    }
    applyRoleGatedNav();
    enterHomeOrSupervisorShell();
  }
}

// ===== ACCESS REQUESTS UI =====
export async function loadSupportSla(): Promise<void> {
  if (!canAdmin()) return;
  try {
    const data: AdminTicketsSlaResponse = await window.apiClient.getSupportAdminTickets(authHeaders());
    const box = document.getElementById('supportSlaBox');
    if (!box) return;
    const items = data.items || [];
    if (!items.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML =
      '<div class="section-title">SLA тикетов</div>' +
      items
        .slice(0, 15)
        .map((t) => {
          const st = t.sla_status || '';
          const col = st === 'breached' ? '#ff3b30' : st === 'waiting' ? '#ff9f0a' : '#34c759';
          return `<div class="progress-block" style="margin:6px 12px;padding:10px;border-left:3px solid ${col}">
            <div style="font-weight:600;font-size:13px">${esc(t.full_name || t.category || 'Тикет #' + t.id)}</div>
            <div style="font-size:11px;color:var(--hint)">${st} · due ${String(t.sla_due_at || '').slice(0, 16)}</div>
          </div>`;
        })
        .join('');
  } catch (_) {}
}

export async function loadAccessRequests(): Promise<void> {
  const box = document.getElementById('accessList');
  if (!box) return;
  if (!canAdmin() && !canApprove()) {
    box.innerHTML = '<div class="empty">Только manager / супервайзер</div>';
    return;
  }
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const list: AccessRequestsListResponse = await window.apiClient.getAccessRequests(authHeaders());
    if (!list.length) {
      box.innerHTML = '<div class="empty">Нет заявок</div>';
      return;
    }
    const myAssignable = assignableRoles(me?.role || '');
    const roleOptions = (myAssignable.length ? myAssignable : ['employee']).map((r) => `<option value="${r}"${r === 'employee' ? ' selected' : ''}>${roleLabel(r)}</option>`).join('');
    box.innerHTML = list
      .map(
        (r) => `
          <div class="progress-block" style="margin:8px 12px">
            <div class="row-title">${esc(r.full_name)}</div>
            <div class="row-sub">${r.provider === 'phone' ? 'Тел. ' + esc(r.phone || '') : 'TG ' + r.telegram_id}${r.message ? ' · ' + esc(r.message) : ''}</div>
            <select id="role_req_${r.id}" style="margin-top:8px;width:100%">${roleOptions}</select>
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn-main" style="flex:1" onclick="approveAccess(${r.id})">Подтвердить</button>
              <button class="btn-main" style="flex:1;background:#ff3b30" onclick="rejectAccess(${r.id})">Отклонить</button>
            </div>
          </div>`
      )
      .join('');
  } catch {
    box.innerHTML = '<div class="empty">Ошибка загрузки</div>';
  }
}

export async function approveAccess(id: number): Promise<void> {
  const roleSel = document.getElementById('role_req_' + id) as HTMLSelectElement | null;
  const role = roleSel ? roleSel.value : 'employee';
  try {
    await window.apiClient.approveAccessRequest(authHeaders(true), id, { role });
  } catch (e) {
    toast('Ошибка', 'err');
    return;
  }
  toast('Доступ открыт', 'ok');
  loadAccessRequests();
}

export async function rejectAccess(id: number): Promise<void> {
  try {
    await window.apiClient.rejectAccessRequest(authHeaders(true), id);
  } catch (e) {
    toast('Ошибка', 'err');
    return;
  }
  toast('Отклонено', 'ok');
  loadAccessRequests();
}

// ===== SUPERVISOR DASH =====
function svTone(pct: number): string {
  if (pct >= 85) return 'good';
  if (pct >= 50) return 'mid';
  return 'bad';
}
function svBarColor(pct: number): string {
  if (pct >= 100) return '#30D158';
  if (pct >= 50) return '#FF9F0A';
  return '#FF453A';
}
function svHealthColor(h: number): string {
  if (h >= 75) return '#30D158';
  if (h >= 45) return '#FF9F0A';
  return '#FF453A';
}

function sparklineSVG(trend: any[], key = 'units'): string {
  if (!trend || !trend.length) return '<div class="empty" style="padding:12px">Нет ряда</div>';
  const vals = trend.map((t) => Number(t[key]) || 0);
  const max = Math.max(1, ...vals);
  const w = 320,
    h = 100,
    pad = 8;
  const step = (w - pad * 2) / Math.max(1, vals.length - 1);
  const pts = vals.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - (v / max) * (h - pad * 2);
    return [x, y];
  });
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${pts[pts.length - 1][0]},${h - pad} L${pts[0][0]},${h - pad} Z`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="svFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#8B5CF6" stop-opacity=".35"/>
            <stop offset="100%" stop-color="#8B5CF6" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#svFill)"/>
        <path d="${line}" fill="none" stroke="#8B5CF6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${pts.length ? `<circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3.5" fill="#fff" stroke="#8B5CF6" stroke-width="2"/>` : ''}
      </svg>`;
}

// ===== SUPERVISOR SHELL — отдельный визуал, изолирован от manager/senior.
// Реальный supervisor видит ТОЛЬКО этот shell (см. enterHomeOrSupervisorShell()
// в bootApp() ниже) — обычные 5 вкладок для него не монтируются вообще.
// admin заходит через кнопку «Кабинет супервайзера» и видит «‹ Назад».
let svDashData: SupervisorDashboardResponse | null = null;

export function enterSupervisorShell(): void {
  const mainNav = document.getElementById('bottomNavMain') as HTMLElement | null;
  const svNav = document.getElementById('bottomNavSupervisor') as HTMLElement | null;
  if (mainNav) mainNav.style.display = 'none';
  if (svNav) svNav.style.display = 'flex';
  const exitBtn = document.getElementById('svExitBtn') as HTMLElement | null;
  // Реальному supervisor'у возвращаться некуда — у него нет обычного shell,
  // кнопка «Назад» только для admin, который сюда заглянул.
  if (exitBtn) exitBtn.style.display = isSupervisor() ? 'none' : '';
  switchPage('sv-overview');
  loadSupervisorData(false);
}

export function exitSupervisorShell(): void {
  const mainNav = document.getElementById('bottomNavMain') as HTMLElement | null;
  const svNav = document.getElementById('bottomNavSupervisor') as HTMLElement | null;
  if (svNav) svNav.style.display = 'none';
  if (mainNav) mainNav.style.display = 'flex';
  switchPage('home');
}

/** Единая точка ветвления для всех веток bootApp(), где раньше был
 * loadHome() — по аналогии с hideSplash(), не патчим 4 места отдельно. */
function enterHomeOrSupervisorShell(): void {
  if (me?.role === 'supervisor') {
    enterSupervisorShell();
  } else {
    loadHome();
  }
}

export async function loadSupervisorData(forceRefresh?: boolean): Promise<void> {
  if (svDashData && !forceRefresh) {
    renderSvAll(svDashData);
    return;
  }
  const days = Number((document.getElementById('svTrendDays') as HTMLSelectElement | null)?.value) || 14;
  ['svOverviewBody', 'svStoresBody', 'svPeopleBody', 'svTrendBody'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="skeleton" style="margin:16px"></div>';
  });
  try {
    svDashData = await window.apiClient.getSupervisorDashboard(authHeaders(), days, orgQueryParam());
    renderSvAll(svDashData);
  } catch (e: any) {
    console.error(e);
    const msg = `<div class="empty">Кабинет супервайзера недоступен<br><span style="font-size:12px;opacity:.7">${e && e.message ? e.message : e}</span></div>`;
    ['svOverviewBody', 'svStoresBody', 'svPeopleBody', 'svTrendBody'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = msg;
    });
  }
}

function renderSvAll(d: SupervisorDashboardResponse): void {
  renderSvOverview(d);
  renderSvStores(d);
  renderSvPeople(d);
  renderSvTrend(d);
}

function renderSvOverview(d: any): void {
  const box = document.getElementById('svOverviewBody');
  if (!box) return;
  const net = d.network || {};
  const health = Number(net.health) || 0;
  const hColor = svHealthColor(health);
  const pace = Number(net.pace_delta) || 0;
  const paceClass = pace >= 0 ? 'ahead' : 'behind';
  const paceText = pace >= 0 ? '+' + pace + '% к темпу дня' : pace + '% к темпу дня';

  let html = `
        <div class="sv-hero">
          <div class="sv-kicker">Supervisor · T2 Analytics</div>
          <div class="sv-title">Сектор под контролем</div>
          <div class="sv-sub">${d.date || ''} · ${net.stores_count || 0} точек · на смене ${net.staff_on_shift || 0}</div>
          <div class="sv-health-row">
            <div class="sv-ring" style="--sv-p:${health};--sv-h:${hColor}"><span style="color:${hColor}">${health}</span></div>
            <div class="sv-metrics">
              <div class="sv-metric"><div class="n">${net.overall_pct || 0}%</div><div class="l">План дня</div></div>
              <div class="sv-metric"><div class="n">${net.day_progress_pct || 0}%</div><div class="l">Прогресс дня</div></div>
              <div class="sv-metric"><div class="n">${net.sim || 0}/${net.plan_sim || 0}</div><div class="l">SIM</div></div>
              <div class="sv-metric"><div class="n">${net.mnp || 0}/${net.plan_mnp || 0}</div><div class="l">MNP</div></div>
            </div>
          </div>
          <div class="sv-pace">
            <span>Темп: <b class="${paceClass}">${paceText}</b></span>
            <span>Просадки: <b>${net.drops_count || 0}</b></span>
          </div>
        </div>
      `;

  html += `<div class="sv-section">Просадки и риски <span>· live</span></div>`;
  if ((d.drops || []).length) {
    html +=
      '<div class="workspace-grid">' +
      d.drops
        .map(
          (x: any) => `
          <div class="sv-drop ${x.severity === 'critical' ? '' : 'warn'}">
            <div class="ico">${x.severity === 'critical' ? '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M7 18v-6a5 5 0 1 1 10 0v6" /> <path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z" /> <path d="M21 12h1" /> <path d="M18.5 4.5 18 5" /> <path d="M2 12h1" /> <path d="M12 2v1" /> <path d="m4.929 4.929.707.707" /> <path d="M12 12v6" /> </svg>' : '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" /> </svg>'}</div>
            <div style="flex:1">
              <div class="t">${esc(x.store_name || 'Точка')}</div>
              <div class="s">${esc(x.message || '')}${x.overall != null ? ' · ' + x.overall + '% плана' : ''}</div>
              ${x.ai_comment ? `<div class="s" style="margin-top:4px;font-style:italic"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 8V4H8" /> <rect width="16" height="12" x="4" y="8" rx="2" /> <path d="M2 14h2" /> <path d="M20 14h2" /> <path d="M15 13v2" /> <path d="M9 13v2" /> </svg> ${esc(x.ai_comment)}</div>` : ''}
              ${x.store_id ? `<button class="mchip" style="margin-top:6px" onclick="event.stopPropagation();proposeMoveForStore('${x.store_id}')">Предложить перенос</button>` : ''}
            </div>
          </div>`
        )
        .join('') +
      '</div>';
  } else {
    html += `<div class="empty" style="padding:12px 16px">Критических просадок нет — сектор в ритме</div>`;
  }

  box.innerHTML = html;
}

// Общий примитив строки-бара — используется и на «Точки» (сегодня), и на
// «Тренд» (месячный план/прогноз, сектор и по точкам).
export function svBarRowHTML(label: string, fact: number, plan: number): string {
  const p = plan > 0 ? Math.round((fact / plan) * 100) : fact > 0 ? 100 : 0;
  return `<div class="sv-bar-row">
        <div>${esc(label)}</div>
        <div class="sv-bar-track"><div class="sv-bar-fill" style="width:${Math.min(100, p)}%;background:${svBarColor(p)}"></div></div>
        <div style="text-align:right">${fact || 0}/${plan || 0}</div>
      </div>`;
}

// «Ещё метрики» на строках-барах (не на сетке .mt-cell — см. .sv-extra в
// styles.css) — toggleMonthExtra() из src/pages/plans-bfq переиспользуется
// как есть, он только дёргает класс .open и текст кнопки.
export function svExtraToggleHTML(idPrefix: string, rowsHtml: string): string {
  return `<div class="mt-more">
        <button type="button" class="sv-toggle" onclick="toggleMonthExtra('${idPrefix}', this)">Ещё метрики ▾</button>
        <div class="sv-extra" id="${idPrefix}">${rowsHtml}</div>
      </div>`;
}

function renderSvStores(d: any): void {
  const box = document.getElementById('svStoresBody');
  if (!box) return;
  box.innerHTML =
    (d.stores || [])
      .map((s: any, idx: number) => {
        const t = s.today || {};
        const o = Number(t.overall) || 0;
        const badge = svTone(o);
        const bars = [
          { l: 'SIM', f: t.sim, p: t.plan_sim },
          { l: 'MNP', f: t.mnp, p: t.plan_mnp },
          { l: 'ПА', f: t.pa, p: t.plan_pa }
        ]
          .map((b) => svBarRowHTML(b.l, b.f, b.p))
          .join('');
        // Остальные метрики (кроме уже показанных SIM/MNP/ПА) — под «Ещё метрики»
        const shown = new Set(['sim', 'mnp', 'pa']);
        const extraIds = METRICS.map((m) => m.id).filter((id) => !shown.has(id));
        const extraRows = extraIds
          .map((id) => {
            const v = (t.metrics && t.metrics[id]) || {};
            return svBarRowHTML(metricLabel(id), v.fact || 0, v.plan || 0);
          })
          .join('');
        const staff = (s.staff || []).map((x: any) => x.name.split(' ')[0]).join(', ') || '—';
        const alerts = (s.alerts || []).map((a: string) => `<div style="font-size:11px;color:#FF9F0A;margin-top:4px">• ${esc(a)}</div>`).join('');
        return `<div class="sv-store" style="--sc:${s.color || '#8B5CF6'}">
          <div class="sv-store-head">
            <div>
              <div class="sv-store-name">${esc(s.name)}</div>
              <div class="sv-store-org">${esc(s.org_name || '')}</div>
              <div class="sv-store-code">${s.code || ''} · на смене ${s.staff_count || 0}</div>
            </div>
            <div class="sv-badge ${badge}">${o}%</div>
          </div>
          <div class="sv-bars">${bars}</div>
          ${svExtraToggleHTML('svst-' + idx, extraRows)}
          <div class="sv-staff"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <path d="M16 3.128a4 4 0 0 1 0 7.744" /> <path d="M22 21v-2a4 4 0 0 0-3-3.87" /> <circle cx="9" cy="7" r="4" /> </svg> ${esc(staff)}</div>
          ${alerts}
        </div>`;
      })
      .join('') || '<div class="empty">Нет точек — сектор не назначен</div>';
}

function renderSvPeople(d: any): void {
  const box = document.getElementById('svPeopleBody');
  if (!box) return;
  box.innerHTML =
    (d.top_employees || [])
      .map(
        (e: any, i: number) => `
        <div class="sv-rank">
          <div class="pos ${i < 3 ? 'gold' : ''}">${e.rank || i + 1}</div>
          <div class="body">
            <div class="name">${esc(e.full_name)}</div>
            <div class="org">${esc(e.org_name || '')}</div>
            <div class="sub">SIM ${e.sim} · MNP ${e.mnp} · ПА ${e.pa} · score ${e.score}</div>
          </div>
        </div>`
      )
      .join('') || '<div class="empty">Нет продаж за период</div>';
}

// Месячный план: сектор целиком или одна точка. values — {sim:{...},...},
// valueKey — 'fact' для «выполнено сейчас», 'total' для «прогноз на конец месяца».
function svMonthPlanBlock(idPrefix: string, values: any, valueKey: string): string {
  const ids = METRICS.map((m) => m.id);
  const main = ids.slice(0, 6);
  const extra = ids.slice(6);
  const rowsFor = (list: string[]) =>
    list
      .map((id) => {
        const v = values[id] || {};
        return svBarRowHTML(metricLabel(id), v[valueKey] || 0, v.plan || 0);
      })
      .join('');
  return `<div class="sv-bars">${rowsFor(main)}</div>${svExtraToggleHTML(idPrefix, rowsFor(extra))}`;
}

function renderSvTrend(d: any): void {
  const box = document.getElementById('svTrendBody');
  if (!box) return;
  const net = d.network || {};
  const netMonth = net.month || {};
  const netFactPct = pctOfMetric(netMonth.metrics);
  const netForecastPct = pctOfMetricForecast(netMonth.forecast);

  let html = `
        <div class="sv-chart">
          ${sparklineSVG(d.trend || [], 'units')}
          <div class="sv-chart-legend">
            <span><i style="background:#8B5CF6"></i>Units / день</span>
            <span>с ${d.from || ''} по ${d.date || ''}</span>
          </div>
        </div>
      `;

  html += `<div class="sv-section">Месячный план — весь сектор <span>· выполнено сейчас: ${netFactPct}%</span></div>`;
  html += `<div class="sv-store" style="--sc:#8B5CF6">${svMonthPlanBlock('svmp-net', netMonth.metrics || {}, 'fact')}</div>`;

  html += `<div class="sv-section">Прогноз на конец месяца — сектор <span>· ожидается: ${netForecastPct}%</span></div>`;
  html += `<div class="sv-store" style="--sc:#8B5CF6">${svMonthPlanBlock('svfc-net', netMonth.forecast || {}, 'total')}</div>`;

  html += `<div class="sv-section">Прогноз по точкам <span>· план на месяц каждой точки</span></div>`;
  const forecastStoresHtml = (d.stores || [])
    .map((s: any, idx: number) => {
      const fc = (s.month && s.month.forecast) || {};
      const overallFc = pctOfMetricForecast(fc);
      return `<div class="sv-store" style="--sc:${s.color || '#8B5CF6'}">
          <div class="sv-store-head">
            <div>
              <div class="sv-store-name">${esc(s.name)}</div>
              <div class="sv-store-org">${esc(s.org_name || '')}</div>
            </div>
            <div class="sv-badge ${svTone(overallFc)}">${overallFc}%</div>
          </div>
          ${svMonthPlanBlock('svfcs-' + idx, fc, 'total')}
        </div>`;
    })
    .join('');
  html += forecastStoresHtml ? `<div class="workspace-grid">${forecastStoresHtml}</div>` : '<div class="empty">Нет точек</div>';

  box.innerHTML = html;
}

function n0(v: unknown): number {
  return Number(v) || 0;
}
// Метрики в разных единицах (штуки SIM vs рубли Аксессуары) — суммировать
// сырые значения через все 15 нельзя, это бессмысленное число. Общий %
// считаем как СРЕДНЕЕ уже готовых процентов по каждой метрике — тот же
// принцип, что storeCard.today.overall (среднее simPct/mnpPct/paPct).
function avgPct(getPct: (id: string) => unknown): number {
  const vals = METRICS.map((m) => n0(getPct(m.id)));
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}
function pctOfMetric(metrics: any): number {
  if (!metrics) return 0;
  return avgPct((id) => (metrics[id] || {}).pct);
}
function pctOfMetricForecast(forecast: any): number {
  if (!forecast) return 0;
  return avgPct((id) => (forecast[id] || {}).pct);
}

declare global {
  interface Window {
    bootApp: typeof bootApp;
    showAccessGate: typeof showAccessGate;
    onGateClaimChange: typeof onGateClaimChange;
    submitAccessRequest: typeof submitAccessRequest;
    loadSupportSla: typeof loadSupportSla;
    loadAccessRequests: typeof loadAccessRequests;
    approveAccess: typeof approveAccess;
    rejectAccess: typeof rejectAccess;
    enterSupervisorShell: typeof enterSupervisorShell;
    exitSupervisorShell: typeof exitSupervisorShell;
    loadSupervisorData: typeof loadSupervisorData;
    svBarRowHTML: typeof svBarRowHTML;
    svExtraToggleHTML: typeof svExtraToggleHTML;
    showLoginGate: typeof showLoginGate;
    submitPhoneLogin: typeof submitPhoneLogin;
    submitPhoneRegister: typeof submitPhoneRegister;
    submitPasswordReset: typeof submitPasswordReset;
    submitMfaLoginCode: typeof submitMfaLoginCode;
    submitMfaTotpEnrollStart: typeof submitMfaTotpEnrollStart;
    submitMfaTotpConfirmCode: typeof submitMfaTotpConfirmCode;
    ackMfaRecoveryCodesSaved: typeof ackMfaRecoveryCodesSaved;
    logoutFromMfaGate: typeof logoutFromMfaGate;
    showMfaTelegramReverifyGate: typeof showMfaTelegramReverifyGate;
    submitMfaTelegramReverifyCode: typeof submitMfaTelegramReverifyCode;
  }
}
window.bootApp = bootApp;
window.showAccessGate = showAccessGate;
window.onGateClaimChange = onGateClaimChange;
window.submitAccessRequest = submitAccessRequest;
window.loadSupportSla = loadSupportSla;
window.loadAccessRequests = loadAccessRequests;
window.approveAccess = approveAccess;
window.rejectAccess = rejectAccess;
window.enterSupervisorShell = enterSupervisorShell;
window.exitSupervisorShell = exitSupervisorShell;
window.loadSupervisorData = loadSupervisorData;
window.svBarRowHTML = svBarRowHTML;
window.svExtraToggleHTML = svExtraToggleHTML;
window.showLoginGate = showLoginGate;
window.submitPhoneLogin = submitPhoneLogin;
window.submitPhoneRegister = submitPhoneRegister;
window.submitPasswordReset = submitPasswordReset;
window.submitMfaLoginCode = submitMfaLoginCode;
window.submitMfaTotpEnrollStart = submitMfaTotpEnrollStart;
window.submitMfaTotpConfirmCode = submitMfaTotpConfirmCode;
window.ackMfaRecoveryCodesSaved = ackMfaRecoveryCodesSaved;
window.logoutFromMfaGate = logoutFromMfaGate;
window.showMfaTelegramReverifyGate = showMfaTelegramReverifyGate;
window.submitMfaTelegramReverifyCode = submitMfaTelegramReverifyCode;

// init
bootApp();
