/**
 * "Чат сотрудников" — внутренний общий чат сети (20.57.0, §18-23 брифа).
 * Как и tasks.ts/alerts.ts — реальная TS-страница поверх router.ts
 * (registerPage/renderPage), с window.loadChatPage-мостиком в старый
 * switchPage()/loadPage() if-chain (app/nav.ts), см. README §22.
 *
 * Рендеринг сообщений — тот же esc()+innerHTML паттерн, что весь
 * остальной фронтенд (не React): §16 брифа требует "никогда innerHTML =
 * message.body" буквально, но по факту весь фронтенд ТАК И рендерит любой
 * пользовательский текст — innerHTML САМ ПО СЕБЕ безопасен, когда
 * интерполируемая строка уже прошла esc(); опасно как раз innerHTML =
 * СЫРОЙ body без esc(), чего здесь нигде нет. renderMessageBody() ниже —
 * единственное место, где body вообще касается разметки.
 */
import { registerPage, renderPage } from '../../app/router.js';
import { RealtimeTransport } from './realtime-transport.js';
import type { ChatMessage, ChatAttachment } from '../../../../src/shared/api-types.js';

const MAX_BODY_LENGTH = 5000;
const MAX_ATTACHMENTS_PER_MESSAGE = 5;
const HISTORY_PAGE_SIZE = 50;
const LOAD_MORE_SCROLL_THRESHOLD = 80;

type PendingStatus = 'sending' | 'failed';

interface PendingEntry {
  clientMessageId: string;
  body: string | null;
  files: File[];
  // Параллельно files — id уже успешно подготовленного (загруженного)
  // вложения, или null пока файл ещё не загружен/загрузка провалилась.
  // Хранится здесь, а не пересоздаётся заново, именно затем, чтобы retry
  // (см. retryChatMessage/submitChatMessage) переиспользовал уже готовые
  // id вместо повторной загрузки тех же байтов с нуля (hotfix 20.57.1
  // PASS 2, finding #4 — "retry / orphan blobs").
  attachmentIds: (string | null)[];
  status: PendingStatus;
}

// canonical messages, ASC (старые -> новые) — соответствует порядку рендера.
let messages: ChatMessage[] = [];
const pendingByClientId = new Map<string, PendingEntry>();
let oldestCursor: string | null = null; // id самого старого загруженного canonical-сообщения
let hasMoreHistory = true;
let loadingOlder = false;
let initialized = false;
let transport: RealtimeTransport | null = null;
let composerFiles: File[] = [];
let isComposing = false; // IME composition guard (§20 брифа)

function feedEl(): HTMLElement | null {
  return document.getElementById('chatFeed');
}

function scrollBox(): HTMLElement | null {
  return document.getElementById('chatScrollBox');
}

function isNearBottom(): boolean {
  const box = scrollBox();
  if (!box) return true;
  return box.scrollHeight - box.scrollTop - box.clientHeight < 120;
}

function scrollToBottom(): void {
  const box = scrollBox();
  if (box) box.scrollTop = box.scrollHeight;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
  } catch {
    return '';
  }
}

/** esc() -> linkify (на уже экранированной строке, безопасно — см. заголовок
 * файла) -> перенос строк в <br>, в этом порядке: URL-регэксп не должен
 * пересекать уже вставленные теги. */
function renderMessageBody(body: string): string {
  const escaped = esc(body);
  const linkified = escaped.replace(/https?:\/\/[^\s<]+/g, (url) => {
    // trailing-пунктуация не должна утаскиваться в ссылку ("текст (https://a.com)." — точка/скобка снаружи).
    const trailingMatch = /[),.!?;:]+$/.exec(url);
    const trailing = trailingMatch ? trailingMatch[0] : '';
    const core = trailing ? url.slice(0, -trailing.length) : url;
    return `<a href="${core}" target="_blank" rel="noopener noreferrer">${core}</a>${trailing}`;
  });
  return linkified.replace(/\n/g, '<br>');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/**
 * data-* атрибуты + делегирование (onAttachmentClick/onFeedClick ниже), не
 * inline onclick="...('${originalFilename}')": esc() экранирует для HTML-
 * атрибута, но браузер HTML-декодирует атрибут ДО компиляции его как JS для
 * inline-обработчика — `&#39;` снова становится `'` в момент выполнения, и
 * escaped-строка ломает JS-строковый контекст (stored XSS через имя файла
 * вложения). Обычный HTML-атрибут (data-*) такой проблеме не подвержен —
 * значение читается как текст, не компилируется как код (hotfix 20.57.1,
 * finding #4).
 */
function attachmentHtml(a: ChatAttachment): string {
  return `
    <button class="chat-attachment" data-attachment-id="${esc(a.id)}" data-attachment-filename="${esc(a.originalFilename)}">
      <span class="chat-attachment-name">${esc(a.originalFilename)}</span>
      <span class="chat-attachment-size">${formatSize(a.sizeBytes)}</span>
    </button>`;
}

function myEmployeeId(): number | null {
  return window.me?.employee_id ?? null;
}

function canonicalMessageHtml(m: ChatMessage): string {
  const mine = m.sender.id === myEmployeeId();
  const attachmentsHtml = m.attachments.length ? `<div class="chat-attachments">${m.attachments.map(attachmentHtml).join('')}</div>` : '';
  const bodyHtml = m.body ? `<div class="chat-bubble-text">${renderMessageBody(m.body)}</div>` : '';
  return `
    <div class="chat-message${mine ? ' chat-message-mine' : ''}" data-message-id="${m.id}">
      <div class="chat-bubble">
        <div class="chat-bubble-meta">
          <span class="chat-sender-name">${esc(m.sender.displayName)}</span>
          <span class="chat-sender-role">${esc(roleLabel(m.sender.role))}</span>
        </div>
        ${bodyHtml}
        ${attachmentsHtml}
        <div class="chat-bubble-time">${formatTime(m.createdAt)}</div>
      </div>
    </div>`;
}

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    trainee: 'Стажёр',
    employee: 'Сотрудник',
    senior: 'Старший',
    manager: 'Управляющий',
    supervisor: 'Супервайзер',
    admin: 'Админ'
  };
  return map[role] || role;
}

function pendingMessageHtml(p: PendingEntry): string {
  const statusLabel = p.status === 'sending' ? 'Отправка…' : 'Не отправлено';
  const retryBtn =
    p.status === 'failed' ? `<button class="chat-retry-btn" onclick="retryChatMessage('${p.clientMessageId}')">Повторить</button>` : '';
  const filesHtml = p.files.length
    ? `<div class="chat-attachments">${p.files.map((f) => `<span class="chat-attachment-name">${esc(f.name)}</span>`).join('')}</div>`
    : '';
  const bodyHtml = p.body ? `<div class="chat-bubble-text">${renderMessageBody(p.body)}</div>` : '';
  return `
    <div class="chat-message chat-message-mine chat-message-pending" data-client-message-id="${p.clientMessageId}">
      <div class="chat-bubble">
        ${bodyHtml}
        ${filesHtml}
        <div class="chat-bubble-time chat-pending-status ${p.status === 'failed' ? 'chat-pending-failed' : ''}">${statusLabel} ${retryBtn}</div>
      </div>
    </div>`;
}

function renderFeed(preserveScroll: { fromTop: boolean } | null): void {
  const feed = feedEl();
  const box = scrollBox();
  if (!feed || !box) return;
  const prevHeight = box.scrollHeight;
  const wasNearBottom = isNearBottom();

  const canonicalHtml = messages.map(canonicalMessageHtml).join('');
  const pendingHtml = [...pendingByClientId.values()].map(pendingMessageHtml).join('');
  feed.innerHTML = canonicalHtml + pendingHtml;

  if (preserveScroll?.fromTop) {
    box.scrollTop = box.scrollHeight - prevHeight;
  } else if (wasNearBottom) {
    scrollToBottom();
  } else {
    showNewMessagesIndicator();
  }
}

function showNewMessagesIndicator(): void {
  const el = document.getElementById('chatNewMessagesIndicator');
  if (el) el.style.display = 'flex';
}
function hideNewMessagesIndicator(): void {
  const el = document.getElementById('chatNewMessagesIndicator');
  if (el) el.style.display = 'none';
}

export function jumpToChatBottom(): void {
  scrollToBottom();
  hideNewMessagesIndicator();
}

function upsertCanonicalMessage(m: ChatMessage): void {
  // Дедупликация по canonical id (§22 брифа) — WS push, polling catch-up и
  // собственный POST-response вполне могут доставить один и тот же id.
  if (messages.some((x) => x.id === m.id)) return;
  pendingByClientId.delete(m.clientMessageId);
  messages.push(m);
  messages.sort((a, b) => Number(a.id) - Number(b.id));
}

function onRealtimeMessage(m: ChatMessage): void {
  const wasNearBottom = isNearBottom();
  upsertCanonicalMessage(m);
  renderFeed(null);
  if (wasNearBottom) hideNewMessagesIndicator();
}

async function loadInitialHistory(): Promise<void> {
  const feed = feedEl();
  if (feed) feed.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.getChatMessages(authHeaders(), undefined, HISTORY_PAGE_SIZE);
    // Backend отдаёт DESC (новые первые) — разворачиваем для рендера сверху вниз.
    messages = [...res.items].reverse();
    oldestCursor = res.nextCursor;
    hasMoreHistory = res.nextCursor !== null;
    renderFeed(null);
    scrollToBottom();
  } catch (e) {
    if (feed) feed.innerHTML = '<div class="chat-error">Не удалось загрузить чат</div>';
    toast('Не удалось загрузить чат', 'err');
  }
}

async function loadOlderMessages(): Promise<void> {
  if (loadingOlder || !hasMoreHistory || !oldestCursor) return;
  loadingOlder = true;
  try {
    const res = await window.apiClient.getChatMessages(authHeaders(), oldestCursor, HISTORY_PAGE_SIZE);
    const older = [...res.items].reverse();
    messages = [...older, ...messages];
    oldestCursor = res.nextCursor;
    hasMoreHistory = res.nextCursor !== null;
    renderFeed({ fromTop: true });
  } catch {
    toast('Не удалось загрузить историю', 'err');
  } finally {
    loadingOlder = false;
  }
}

function lastKnownId(): string | null {
  if (messages.length) return messages[messages.length - 1].id;
  return null;
}

/** apiClient.getChatMessages() — общая сигнатура под "before"-курсор
 * (§21 брифа, история/скролл вверх); "after" (§8/§9: catch-up/polling) —
 * отдельный, узкий вызов напрямую, не через тот же helper. */
async function fetchAfterDirect(afterId: string): Promise<ChatMessage[]> {
  const headers = authHeaders();
  const res = await fetch(`${window.location.origin}/chat/messages?after=${encodeURIComponent(afterId)}&limit=${HISTORY_PAGE_SIZE}`, {
    headers
  });
  if (!res.ok) throw new Error(`chat_after_failed:${res.status}`);
  const data = (await res.json()) as { items: ChatMessage[] };
  return data.items;
}

function setComposerFiles(files: File[]): void {
  composerFiles = files.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
  const box = document.getElementById('chatComposerFiles');
  if (!box) return;
  if (!composerFiles.length) {
    box.innerHTML = '';
    box.style.display = 'none';
    return;
  }
  box.style.display = 'flex';
  box.innerHTML = composerFiles
    .map(
      (f, i) => `<span class="chat-composer-file">${esc(f.name)} <button onclick="removeChatComposerFile(${i})" aria-label="Убрать">×</button></span>`
    )
    .join('');
}

export function removeChatComposerFile(index: number): void {
  composerFiles.splice(index, 1);
  setComposerFiles(composerFiles);
  updateSendButtonState();
}

export function onChatAttachmentPicked(input: HTMLInputElement): void {
  const picked = Array.from(input.files || []);
  input.value = '';
  if (!picked.length) return;
  const combined = [...composerFiles, ...picked];
  if (combined.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    toast(`Максимум ${MAX_ATTACHMENTS_PER_MESSAGE} вложений на сообщение`, 'err');
  }
  setComposerFiles(combined);
  updateSendButtonState();
}

function composerTextarea(): HTMLTextAreaElement | null {
  return document.getElementById('chatComposerInput') as HTMLTextAreaElement | null;
}

function updateSendButtonState(): void {
  const btn = document.getElementById('chatSendBtn') as HTMLButtonElement | null;
  const ta = composerTextarea();
  if (!btn) return;
  const hasBody = !!ta?.value.trim();
  btn.disabled = !hasBody && composerFiles.length === 0;
}

export function onChatComposerInput(): void {
  updateSendButtonState();
}

export function onChatComposerCompositionStart(): void {
  isComposing = true;
}
export function onChatComposerCompositionEnd(): void {
  isComposing = false;
}

/** Enter = отправка, Shift+Enter = перенос строки, но не во время IME
 * (композиция иероглифов/эмодзи и т.п. — §20 брифа) — composing-событие
 * фиксируем отдельно (isComposing), т.к. event.isComposing в некоторых
 * браузерах ненадёжен на samsung-клавиатурах при первом Enter. */
export function onChatComposerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || isComposing || event.isComposing) return;
  event.preventDefault();
  void sendChatMessage();
}

async function uploadOneAttachment(file: File): Promise<string | null> {
  const form = new FormData();
  form.append('file', file, file.name);
  try {
    const res = await window.apiClient.uploadChatAttachment(authHeaders(), form);
    return res.id;
  } catch (e: any) {
    toast(`${file.name}: ${e?.message || 'ошибка загрузки'}`, 'err');
    return null;
  }
}

export async function sendChatMessage(): Promise<void> {
  const ta = composerTextarea();
  const body = ta?.value.trim() || '';
  const files = composerFiles;
  if (!body && !files.length) return;

  if (body.length > MAX_BODY_LENGTH) {
    toast(`Сообщение длиннее ${MAX_BODY_LENGTH} символов`, 'err');
    return;
  }

  const clientMessageId = crypto.randomUUID();
  if (ta) ta.value = '';
  setComposerFiles([]);
  updateSendButtonState();

  pendingByClientId.set(clientMessageId, {
    clientMessageId,
    body: body || null,
    files,
    attachmentIds: files.map(() => null),
    status: 'sending'
  });
  renderFeed(null);
  scrollToBottom();
  await submitChatMessage(clientMessageId);
}

/**
 * Тот же clientMessageId — сервер идемпотентен (§23 брифа), повторный POST
 * после неизвестного network outcome (потерян ответ на успешный POST)
 * безопасен: insertMessageIfAbsent вернёт уже существующее сообщение.
 *
 * Уже загруженные вложения (entry.attachmentIds[i] уже заполнен) НЕ
 * загружаются повторно — только файлы, для которых предыдущая попытка ещё
 * не получила id (первая отправка ИЛИ сама загрузка байт оборвалась), что
 * и покрывает "неопределённый результат POST": байты вложения могли уже
 * долететь и остаться prepared на сервере, а вот ответ на сам POST
 * /chat/messages — нет (hotfix 20.57.1 PASS 2, finding #4).
 */
async function submitChatMessage(clientMessageId: string): Promise<void> {
  const entry = pendingByClientId.get(clientMessageId);
  if (!entry) return;

  try {
    for (let i = 0; i < entry.files.length; i++) {
      if (entry.attachmentIds[i]) continue; // уже подготовлено предыдущей попыткой — переиспользуем id, не льём байты заново
      entry.attachmentIds[i] = await uploadOneAttachment(entry.files[i]);
    }
    const attachmentIds = entry.attachmentIds.filter((id): id is string => !!id);
    if (!entry.body && !attachmentIds.length) {
      // Все вложения не прошли валидацию, текста нет — нечего отправлять.
      pendingByClientId.delete(clientMessageId);
      renderFeed(null);
      return;
    }
    const canonical = await window.apiClient.postChatMessage(authHeaders(), { clientMessageId, body: entry.body, attachmentIds });
    upsertCanonicalMessage(canonical);
    renderFeed(null);
    scrollToBottom();
  } catch (e: any) {
    // invalid_attachment (fail-closed, finding #3) — сервер только что
    // проверил ИМЕННО ЭТИ id и хотя бы один реально недоступен (истёк/чужой/
    // уже привязан) — это не "сеть моргнула", закешированные id по-настоящему
    // протухли. Сбрасываем их, чтобы следующий retry залил байты заново, а
    // не бесконечно слал те же протухшие id.
    if (e?.code === 'invalid_attachment') {
      entry.attachmentIds = entry.attachmentIds.map(() => null);
    }
    entry.status = 'failed';
    renderFeed(null);
    toast(e?.message || 'Не удалось отправить сообщение', 'err');
  }
}

export async function retryChatMessage(clientMessageId: string): Promise<void> {
  const entry = pendingByClientId.get(clientMessageId);
  if (!entry) return;
  entry.status = 'sending';
  renderFeed(null);
  await submitChatMessage(clientMessageId);
}

export async function downloadChatAttachment(id: string, filename: string): Promise<void> {
  try {
    const blob = await window.apiClient.getChatAttachment(authHeaders(), id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Отложенный revoke (hotfix 20.57.1 PASS 2, finding #5) — некоторые
    // браузеры инициируют сохранение файла асинхронно после click(),
    // немедленный revokeObjectURL мог бы оборвать ещё не начавшуюся
    // загрузку; сам object URL раньше не освобождался вообще (утечка).
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch {
    toast('Не удалось скачать файл', 'err');
  }
}

function onScroll(): void {
  const box = scrollBox();
  if (!box) return;
  if (box.scrollTop < LOAD_MORE_SCROLL_THRESHOLD) void loadOlderMessages();
  if (isNearBottom()) hideNewMessagesIndicator();
}

/** Делегирование кликов по вложениям (см. attachmentHtml — data-* вместо
 * inline onclick, finding #4). closest() ищет ближайшую .chat-attachment
 * кнопку от фактической точки клика (учитывает клики по дочерним <span>). */
function onFeedClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  const btn = target?.closest<HTMLElement>('.chat-attachment[data-attachment-id]');
  if (!btn) return;
  const id = btn.dataset.attachmentId;
  const filename = btn.dataset.attachmentFilename;
  if (id && filename !== undefined) void downloadChatAttachment(id, filename);
}

async function initChatPageOnce(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const box = scrollBox();
  box?.addEventListener('scroll', onScroll);
  feedEl()?.addEventListener('click', onFeedClick);

  await loadInitialHistory();

  transport = new RealtimeTransport({
    onMessage: onRealtimeMessage,
    getLastKnownId: lastKnownId,
    fetchAfter: fetchAfterDirect
  });
  transport.start();
}

registerPage('chat', () => {
  void initChatPageOnce();
});

declare global {
  interface Window {
    loadChatPage: () => void;
    sendChatMessage: typeof sendChatMessage;
    retryChatMessage: typeof retryChatMessage;
    downloadChatAttachment: typeof downloadChatAttachment;
    onChatAttachmentPicked: typeof onChatAttachmentPicked;
    removeChatComposerFile: typeof removeChatComposerFile;
    onChatComposerInput: typeof onChatComposerInput;
    onChatComposerKeydown: typeof onChatComposerKeydown;
    onChatComposerCompositionStart: typeof onChatComposerCompositionStart;
    onChatComposerCompositionEnd: typeof onChatComposerCompositionEnd;
    jumpToChatBottom: typeof jumpToChatBottom;
  }
}
window.loadChatPage = () => {
  renderPage('chat');
};
window.sendChatMessage = sendChatMessage;
window.retryChatMessage = retryChatMessage;
window.downloadChatAttachment = downloadChatAttachment;
window.onChatAttachmentPicked = onChatAttachmentPicked;
window.removeChatComposerFile = removeChatComposerFile;
window.onChatComposerInput = onChatComposerInput;
window.onChatComposerKeydown = onChatComposerKeydown;
window.onChatComposerCompositionStart = onChatComposerCompositionStart;
window.onChatComposerCompositionEnd = onChatComposerCompositionEnd;
window.jumpToChatBottom = jumpToChatBottom;
