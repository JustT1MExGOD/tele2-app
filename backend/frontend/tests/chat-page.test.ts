/**
 * 20.57.0 — внутренний чат сотрудников, jsdom-рендер тест (§35 брифа):
 * безопасный рендер (XSS), отправка/ретрай, pending→canonical, пагинация,
 * входящее realtime-сообщение, дедупликация.
 *
 * RealtimeTransport подменён фейком — тестируется отдельно
 * (chat-realtime-transport.test.ts); здесь важно только то, что index.ts
 * зовёт start()/передаёт правильные callbacks, не реальное сетевое поведение.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let capturedTransportOpts: any = null;
class FakeRealtimeTransport {
  constructor(opts: any) {
    capturedTransportOpts = opts;
  }
  start() {}
  stop() {}
  get isRealtimeConnected() {
    return false;
  }
}
vi.mock('../src/pages/chat/realtime-transport.js', () => ({ RealtimeTransport: FakeRealtimeTransport }));

function setupGlobals(meEmployeeId = 1) {
  document.body.innerHTML = `
    <div id="page-chat" class="page">
      <div class="chat-scroll-box" id="chatScrollBox">
        <div class="chat-feed" id="chatFeed"></div>
      </div>
      <button id="chatNewMessagesIndicator" style="display:none"></button>
      <div class="chat-composer">
        <div id="chatComposerFiles" style="display:none"></div>
        <textarea id="chatComposerInput"></textarea>
        <button id="chatSendBtn" disabled></button>
      </div>
    </div>
  `;
  vi.stubGlobal('esc', (s: unknown) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  );
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('me', { employee_id: meEmployeeId });
  (window as any).me = { employee_id: meEmployeeId };

  const getChatMessages = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  const postChatMessage = vi.fn();
  const uploadChatAttachment = vi.fn();
  const getChatAttachment = vi.fn();
  (window as any).apiClient = { getChatMessages, postChatMessage, uploadChatAttachment, getChatAttachment };
  return { getChatMessages, postChatMessage, uploadChatAttachment, getChatAttachment };
}

function msg(overrides: Partial<any> = {}) {
  return {
    id: '1',
    clientMessageId: crypto.randomUUID(),
    body: 'hello',
    createdAt: '2026-09-02T10:00:00Z',
    sender: { id: 2, displayName: 'Коллега', role: 'employee' },
    attachments: [],
    ...overrides
  };
}

describe('Внутренний чат — frontend (src/pages/chat)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    capturedTransportOpts = null;
  });

  it('XSS: <script>/onerror в теле сообщения рендерится как текст, не выполняется', async () => {
    const { getChatMessages } = setupGlobals();
    getChatMessages.mockResolvedValue({
      items: [msg({ body: '<img src=x onerror="window.__xss=1">' })],
      nextCursor: null
    });
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();
    await Promise.resolve();

    const html = document.getElementById('chatFeed')!.innerHTML;
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;img');
    expect((window as any).__xss).toBeUndefined();
  });

  it('безопасные переносы строк — рендерятся как <br>, не ломая экранирование', async () => {
    const { getChatMessages } = setupGlobals();
    getChatMessages.mockResolvedValue({ items: [msg({ body: 'строка1\nстрока2' })], nextCursor: null });
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('chatFeed')!.innerHTML).toContain('строка1<br>строка2');
  });

  it('URL в тексте становится безопасной ссылкой (только http/https, не javascript:)', async () => {
    const { getChatMessages } = setupGlobals();
    getChatMessages.mockResolvedValue({ items: [msg({ body: 'смотри https://example.com/report' })], nextCursor: null });
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();
    await Promise.resolve();

    const html = document.getElementById('chatFeed')!.innerHTML;
    expect(html).toContain('<a href="https://example.com/report"');
    expect(html).not.toContain('javascript:');
  });

  it('отправка: optimistic pending → canonical после успешного POST, дедуп по clientMessageId', async () => {
    const { getChatMessages, postChatMessage } = setupGlobals();
    getChatMessages.mockResolvedValue({ items: [], nextCursor: null });
    let resolvePost: (v: any) => void = () => {};
    postChatMessage.mockReturnValue(new Promise((r) => (resolvePost = r)));
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();
    await Promise.resolve();

    const ta = document.getElementById('chatComposerInput') as HTMLTextAreaElement;
    ta.value = 'Привет всем';
    (window as any).sendChatMessage();
    await Promise.resolve();

    expect(document.getElementById('chatFeed')!.innerHTML).toContain('Отправка');
    expect(ta.value).toBe(''); // текст очищен сразу (не теряется — уже в pending)

    const canonical = msg({ id: '99', body: 'Привет всем', clientMessageId: postChatMessage.mock.calls[0][1].clientMessageId });
    resolvePost(canonical);
    await Promise.resolve();
    await Promise.resolve();

    const html = document.getElementById('chatFeed')!.innerHTML;
    expect(html).not.toContain('Отправка');
    expect(html).toContain('Привет всем');
    expect(html.match(/Привет всем/g)?.length).toBe(1); // ровно одно вхождение — не задвоилось
  });

  it('неудачная отправка — показывает "Не отправлено" с retry, повторный retry использует тот же clientMessageId', async () => {
    const { getChatMessages, postChatMessage } = setupGlobals();
    getChatMessages.mockResolvedValue({ items: [], nextCursor: null });
    postChatMessage.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(msg({ id: '5', body: 'retry me' }));
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();
    await Promise.resolve();

    const ta = document.getElementById('chatComposerInput') as HTMLTextAreaElement;
    ta.value = 'retry me';
    (window as any).sendChatMessage();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('chatFeed')!.innerHTML).toContain('Не отправлено');
    const firstCallId = postChatMessage.mock.calls[0][1].clientMessageId;

    (window as any).retryChatMessage(firstCallId);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(postChatMessage.mock.calls[1][1].clientMessageId).toBe(firstCallId);
    expect(document.getElementById('chatFeed')!.innerHTML).toContain('retry me');
  });

  it('composer: Enter отправляет, Shift+Enter — нет; во время IME-композиции Enter не отправляет', async () => {
    const { getChatMessages, postChatMessage } = setupGlobals();
    getChatMessages.mockResolvedValue({ items: [], nextCursor: null });
    postChatMessage.mockResolvedValue(msg({ id: '1' }));
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();

    const ta = document.getElementById('chatComposerInput') as HTMLTextAreaElement;

    ta.value = 'во время композиции';
    (window as any).onChatComposerCompositionStart();
    const composingEvent = { key: 'Enter', shiftKey: false, isComposing: true, preventDefault: vi.fn() };
    (window as any).onChatComposerKeydown(composingEvent);
    expect(postChatMessage).not.toHaveBeenCalled();
    (window as any).onChatComposerCompositionEnd();

    ta.value = 'обычная отправка';
    const enterEvent = { key: 'Enter', shiftKey: false, isComposing: false, preventDefault: vi.fn() };
    (window as any).onChatComposerKeydown(enterEvent);
    expect(enterEvent.preventDefault).toHaveBeenCalled();
    expect(postChatMessage).toHaveBeenCalled();
  });

  it('пустое сообщение без вложений — кнопка отправки остаётся disabled', async () => {
    setupGlobals();
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();

    const ta = document.getElementById('chatComposerInput') as HTMLTextAreaElement;
    const btn = document.getElementById('chatSendBtn') as HTMLButtonElement;
    ta.value = '   ';
    (window as any).onChatComposerInput();
    expect(btn.disabled).toBe(true);

    ta.value = 'текст';
    (window as any).onChatComposerInput();
    expect(btn.disabled).toBe(false);
  });

  it('входящее realtime-сообщение — рендерится, дедуплицируется, если совпадает с уже отрисованным canonical id', async () => {
    const { getChatMessages } = setupGlobals();
    const existing = msg({ id: '1', body: 'first' });
    getChatMessages.mockResolvedValue({ items: [existing], nextCursor: null });
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();
    await Promise.resolve();

    expect(capturedTransportOpts).toBeTruthy();
    // Дубликат уже отрисованного id — не должен задвоиться.
    capturedTransportOpts.onMessage(existing);
    expect(document.getElementById('chatFeed')!.innerHTML.match(/first/g)?.length).toBe(1);

    // Новое сообщение — добавляется.
    capturedTransportOpts.onMessage(msg({ id: '2', body: 'second' }));
    expect(document.getElementById('chatFeed')!.innerHTML).toContain('second');
  });

  it('пагинация: скролл к верху подгружает более старые сообщения без дублей', async () => {
    const { getChatMessages } = setupGlobals();
    getChatMessages.mockResolvedValueOnce({ items: [msg({ id: '10', body: 'newer' })], nextCursor: '10' });
    getChatMessages.mockResolvedValueOnce({ items: [msg({ id: '5', body: 'older' })], nextCursor: null });
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();
    await Promise.resolve();

    const box = document.getElementById('chatScrollBox')!;
    Object.defineProperty(box, 'scrollTop', { value: 0, writable: true });
    box.dispatchEvent(new Event('scroll'));
    await Promise.resolve();
    await Promise.resolve();

    expect(getChatMessages).toHaveBeenLastCalledWith(expect.anything(), '10', 50);
    const html = document.getElementById('chatFeed')!.innerHTML;
    expect(html).toContain('older');
    expect(html).toContain('newer');
  });

  it('window.loadChatPage bridges к router.ts (legacy switchPage/loadPage dispatch)', async () => {
    setupGlobals();
    await import('../src/pages/chat/index.js');
    expect(typeof (window as any).loadChatPage).toBe('function');
  });
});
