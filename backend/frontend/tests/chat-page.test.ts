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
  // json=true должен добавлять Content-Type: application/json — иначе
  // fetch() шлёт тело как text/plain и backend не парсит JSON (регрессия
  // 20.57.1, "Некорректные данные запроса"). Не no-op-стаб, чтобы тесты
  // ниже могли различить authHeaders() от authHeaders(true).
  vi.stubGlobal('authHeaders', (json?: boolean) => (json ? { 'Content-Type': 'application/json' } : {}));
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

  it('XSS: вредоносное имя файла вложения не может выполнить JS через inline-обработчик (hotfix 20.57.1, finding #4)', async () => {
    const { getChatMessages, getChatAttachment } = setupGlobals();
    const maliciousFilename = `x'); window.__attachXss=1; //.txt`;
    getChatMessages.mockResolvedValue({
      items: [
        msg({
          body: null,
          attachments: [{ id: 'att-1', originalFilename: maliciousFilename, sizeBytes: 123 }]
        })
      ],
      nextCursor: null
    });
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();
    await Promise.resolve();

    const feed = document.getElementById('chatFeed')!;
    expect(feed.innerHTML).not.toContain('onclick=');
    const btn = feed.querySelector('.chat-attachment') as HTMLElement;
    expect(btn).toBeTruthy();
    expect(btn.dataset.attachmentFilename).toBe(maliciousFilename);
    expect((window as any).__attachXss).toBeUndefined();

    getChatAttachment.mockResolvedValue(new Blob(['data']));
    (window as any).URL.createObjectURL = vi.fn().mockReturnValue('blob:fake');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect((window as any).__attachXss).toBeUndefined();
    expect(getChatAttachment).toHaveBeenCalledWith(expect.anything(), 'att-1');
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

  // Регрессия 20.57.1: POST /chat/messages шёл с authHeaders() вместо
  // authHeaders(true) — тело уходило как text/plain, backend отвечал 400
  // "Некорректные данные запроса" (см. backend/tests/isolation/chat-messages.test.ts
  // для доказательства на уровне HTTP-контракта).
  it('POST /chat/messages шлёт заголовки с Content-Type: application/json (finding — "Некорректные данные запроса")', async () => {
    const { getChatMessages, postChatMessage } = setupGlobals();
    getChatMessages.mockResolvedValue({ items: [], nextCursor: null });
    postChatMessage.mockResolvedValue(msg({ id: '1' }));
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();
    await Promise.resolve();

    const ta = document.getElementById('chatComposerInput') as HTMLTextAreaElement;
    ta.value = 'проверка content-type';
    (window as any).sendChatMessage();
    await Promise.resolve();

    expect(postChatMessage.mock.calls[0][0]).toEqual({ 'Content-Type': 'application/json' });
  });

  // 20.57.2 GHOST SEND — тест A: НАСТОЯЩИЙ отказ сервера (api-client.ts
  // ставит .definitive=true, когда получен реальный HTTP-ответ и res.ok
  // false — доказано backend-тестами: ноль строк/broadcast'ов). Это
  // единственный случай, когда безопасно сразу писать "Не отправлено".
  it('A. definitive HTTP-отказ (400) — сразу "Не отправлено", НЕ уходит в сверку', async () => {
    const { getChatMessages, postChatMessage } = setupGlobals();
    getChatMessages.mockResolvedValue({ items: [], nextCursor: null });
    postChatMessage.mockRejectedValue(
      Object.assign(new Error('Некорректные данные запроса'), { code: 'validation_failed', definitive: true })
    );
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();
    await Promise.resolve();

    const ta = document.getElementById('chatComposerInput') as HTMLTextAreaElement;
    ta.value = 'отклонённое сообщение';
    (window as any).sendChatMessage();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const html = document.getElementById('chatFeed')!.innerHTML;
    expect(html).toContain('Не отправлено');
    expect(html).not.toContain('Статус неизвестен');
    // Сверка (getChatMessages) не запускалась для definitive-отказа — только начальная загрузка истории.
    expect(getChatMessages).toHaveBeenCalledTimes(1);
  });

  // 20.57.2 AMBIGUOUS DELIVERY RECONCILIATION — тест C: ответ на POST
  // потерян (fetch throws без .definitive — сервер мог уже принять), но
  // realtime доставляет canonical с тем же clientMessageId раньше, чем
  // успевает сработать сверка через history API — "Статус неизвестен"
  // должен исчезнуть, дубликата быть не должно.
  it('C. ambiguous исход (ответ потерян) + realtime доставляет canonical — "Статус неизвестен" реконсилируется в sent, без дублей', async () => {
    vi.useFakeTimers();
    try {
      const { getChatMessages, postChatMessage } = setupGlobals();
      getChatMessages.mockResolvedValue({ items: [], nextCursor: null });
      postChatMessage.mockRejectedValue(new Error('response lost')); // сетевая/парсинг-ошибка — без .definitive
      await import('../src/pages/chat/index.js');
      (window as any).loadChatPage();
      await Promise.resolve();
      await Promise.resolve();

      const ta = document.getElementById('chatComposerInput') as HTMLTextAreaElement;
      ta.value = 'сервер принял, ответ потерян';
      (window as any).sendChatMessage();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Неоднозначно — НЕ "Не отправлено", а "Статус неизвестен" (§B требования).
      let html = document.getElementById('chatFeed')!.innerHTML;
      expect(html).toContain('Статус неизвестен');
      expect(html).not.toContain('Не отправлено');
      const clientMessageId = postChatMessage.mock.calls[0][1].clientMessageId;

      // Сервер на самом деле создал сообщение и разослал его всем, включая
      // этого же отправителя (тот же clientMessageId в canonical) — realtime.
      expect(capturedTransportOpts).toBeTruthy();
      capturedTransportOpts.onMessage(msg({ id: '501', body: 'сервер принял, ответ потерян', clientMessageId }));
      await Promise.resolve();

      html = document.getElementById('chatFeed')!.innerHTML;
      expect(html).not.toContain('Статус неизвестен');
      expect(html).not.toContain('Не отправлено');
      expect(html.match(/сервер принял, ответ потерян/g)?.length).toBe(1); // не задвоилось

      // Запланированная сверка больше не должна ничего менять (таймер отменён upsertCanonicalMessage).
      await vi.advanceTimersByTimeAsync(10000);
      html = document.getElementById('chatFeed')!.innerHTML;
      expect(html.match(/сервер принял, ответ потерян/g)?.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // 20.57.2 AMBIGUOUS DELIVERY RECONCILIATION — тест D: ответ потерян,
  // realtime не доставил ничего, но history API (getChatMessages) уже
  // содержит canonical с тем же clientMessageId — ограниченная сверка сама
  // находит его и заменяет "Статус неизвестен" на sent.
  it('D. ambiguous исход + realtime недоступен, но история уже содержит clientMessageId — сверка находит и реконсилирует', async () => {
    vi.useFakeTimers();
    try {
      const { getChatMessages, postChatMessage } = setupGlobals();
      getChatMessages.mockResolvedValueOnce({ items: [], nextCursor: null }); // начальная история — пусто
      postChatMessage.mockRejectedValue(new Error('response lost'));
      await import('../src/pages/chat/index.js');
      (window as any).loadChatPage();
      await Promise.resolve();
      await Promise.resolve();

      const ta = document.getElementById('chatComposerInput') as HTMLTextAreaElement;
      ta.value = 'найдётся через сверку истории';
      (window as any).sendChatMessage();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const clientMessageId = postChatMessage.mock.calls[0][1].clientMessageId;
      expect(document.getElementById('chatFeed')!.innerHTML).toContain('Статус неизвестен');

      // Со следующего вызова getChatMessages (собственно сверка) — сервер
      // УЖЕ принял сообщение, оно есть в истории под тем же clientMessageId.
      getChatMessages.mockResolvedValue({
        items: [msg({ id: '502', body: 'найдётся через сверку истории', clientMessageId })],
        nextCursor: null
      });

      // Первая попытка сверки запланирована с задержкой 0 — прогоняем таймеры.
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();

      const html = document.getElementById('chatFeed')!.innerHTML;
      expect(html).not.toContain('Статус неизвестен');
      expect(html.match(/найдётся через сверку истории/g)?.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // 20.57.2 AMBIGUOUS DELIVERY RECONCILIATION — тест E: запрос реально НЕ
  // дошёл до сервера (настоящий network failure) — history API никогда не
  // содержит этот clientMessageId. После исчерпания ограниченного числа
  // попыток сверки статус остаётся "Статус неизвестен" (с Retry) — НИКОГДА
  // не превращается в ложный "sent" (никакого phantom-sent).
  it('E. настоящий network failure (запрос не дошёл) — история никогда не содержит clientMessageId, статус остаётся "неизвестен", без phantom-sent', async () => {
    vi.useFakeTimers();
    try {
      const { getChatMessages, postChatMessage } = setupGlobals();
      getChatMessages.mockResolvedValue({ items: [], nextCursor: null }); // ни разу не содержит наш clientMessageId
      postChatMessage.mockRejectedValue(new TypeError('Failed to fetch'));
      await import('../src/pages/chat/index.js');
      (window as any).loadChatPage();
      await Promise.resolve();
      await Promise.resolve();

      const ta = document.getElementById('chatComposerInput') as HTMLTextAreaElement;
      ta.value = 'никогда не дошло до сервера';
      (window as any).sendChatMessage();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(document.getElementById('chatFeed')!.innerHTML).toContain('Статус неизвестен');

      // Прогоняем ВСЕ запланированные (ограниченные) попытки сверки целиком.
      await vi.advanceTimersByTimeAsync(20000);
      await Promise.resolve();
      await Promise.resolve();

      const html = document.getElementById('chatFeed')!.innerHTML;
      // Ограниченно — не бесконечно: не более 4 попыток сверки суммарно.
      expect(getChatMessages.mock.calls.length).toBeLessThanOrEqual(5); // 1 начальная история + до 4 сверок
      expect(html).toContain('Статус неизвестен');
      expect(html).not.toContain('Не отправлено'); // никогда не заявляем ложный definitive-отказ
      expect(html.match(/никогда не дошло до сервера/g)?.length).toBe(1); // никакого phantom-дубля
    } finally {
      vi.useRealTimers();
    }
  });

  // 20.57.2 BLOCKER — свежая загрузка страницы (перезагрузка/повторный
  // вход в чат) не должна показывать "призрачное" pending-сообщение,
  // которого больше нет в локальной памяти (сброшена перезагрузкой) — вся
  // видимая история приходит заново с сервера, только то, что реально там есть.
  it('H. после reload/новой загрузки истории видно ТОЛЬКО серверное состояние — никаких унаследованных pending-статусов', async () => {
    const { getChatMessages } = setupGlobals();
    // Pending-состояние из предыдущей сессии — не персистентная память
    // браузера (module-level Map), новый импорт эмулирует полную перезагрузку.
    getChatMessages.mockResolvedValue({
      items: [msg({ id: '501', body: 'сервер принял, ответ потерян' })],
      nextCursor: null
    });
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();
    await Promise.resolve();

    const html = document.getElementById('chatFeed')!.innerHTML;
    expect(html).not.toContain('Не отправлено');
    expect(html).not.toContain('Статус неизвестен');
    expect(html.match(/сервер принял, ответ потерян/g)?.length).toBe(1);
  });

  it('A/F. definitive-отказ — "Не отправлено" с retry, повторный retry использует тот же clientMessageId', async () => {
    const { getChatMessages, postChatMessage } = setupGlobals();
    getChatMessages.mockResolvedValue({ items: [], nextCursor: null });
    postChatMessage
      .mockRejectedValueOnce(Object.assign(new Error('validation'), { code: 'validation_failed', definitive: true }))
      .mockResolvedValueOnce(msg({ id: '5', body: 'retry me' }));
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

  // 20.57.2 — тест F (ambiguous → retry): ручной retry из "Статус неизвестен"
  // (не только из "Не отправлено") тоже переиспользует тот же clientMessageId
  // и отменяет уже запланированную сверку (не гонится параллельно с retry).
  it('F. ручной retry из "Статус неизвестен" переиспользует тот же clientMessageId, отменяет запланированную сверку', async () => {
    vi.useFakeTimers();
    try {
      const { getChatMessages, postChatMessage } = setupGlobals();
      getChatMessages.mockResolvedValue({ items: [], nextCursor: null }); // сверка ничего не найдёт, если вдруг сработает
      postChatMessage
        .mockRejectedValueOnce(new Error('response lost'))
        .mockResolvedValueOnce(msg({ id: '6', body: 'retry from unknown' }));
      await import('../src/pages/chat/index.js');
      (window as any).loadChatPage();
      await Promise.resolve();
      await Promise.resolve();

      const ta = document.getElementById('chatComposerInput') as HTMLTextAreaElement;
      ta.value = 'retry from unknown';
      (window as any).sendChatMessage();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(document.getElementById('chatFeed')!.innerHTML).toContain('Статус неизвестен');
      const firstCallId = postChatMessage.mock.calls[0][1].clientMessageId;
      const reconcileCallsBeforeRetry = getChatMessages.mock.calls.length;

      (window as any).retryChatMessage(firstCallId);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(postChatMessage.mock.calls[1][1].clientMessageId).toBe(firstCallId);
      expect(document.getElementById('chatFeed')!.innerHTML).toContain('retry from unknown');

      // Отменённая сверка не должна больше дёргать getChatMessages за пределами того, что уже случилось до retry.
      await vi.advanceTimersByTimeAsync(20000);
      expect(getChatMessages.mock.calls.length).toBe(reconcileCallsBeforeRetry);
    } finally {
      vi.useRealTimers();
    }
  });

  // 20.57.2 — тест G: и realtime, и запланированная сверка независимо
  // находят один и тот же canonical id — не должно возникнуть дубля в DOM.
  it('G. повторная (гоночная) сверка через realtime и через history API не создаёт дубль в DOM', async () => {
    vi.useFakeTimers();
    try {
      const { getChatMessages, postChatMessage } = setupGlobals();
      getChatMessages.mockResolvedValue({ items: [], nextCursor: null });
      postChatMessage.mockRejectedValue(new Error('response lost'));
      await import('../src/pages/chat/index.js');
      (window as any).loadChatPage();
      await Promise.resolve();
      await Promise.resolve();

      const ta = document.getElementById('chatComposerInput') as HTMLTextAreaElement;
      ta.value = 'гонка realtime и сверки';
      (window as any).sendChatMessage();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const clientMessageId = postChatMessage.mock.calls[0][1].clientMessageId;
      const canonical = msg({ id: '503', body: 'гонка realtime и сверки', clientMessageId });

      // История ТОЖЕ теперь содержит его (на случай, если сверка успеет сработать первой).
      getChatMessages.mockResolvedValue({ items: [canonical], nextCursor: null });

      // Сверка срабатывает первой (задержка 0).
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();

      // ...а следом всё равно прилетает и realtime-push с тем же id.
      capturedTransportOpts.onMessage(canonical);
      await Promise.resolve();

      const html = document.getElementById('chatFeed')!.innerHTML;
      expect(html.match(/гонка realtime и сверки/g)?.length).toBe(1); // ровно одно вхождение
      expect(html).not.toContain('Статус неизвестен');
    } finally {
      vi.useRealTimers();
    }
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

  // Hotfix 20.57.1 PASS 2, finding #4 — "retry / orphan blobs": retry
  // раньше перезаливал ИСХОДНЫЙ File[] с нуля, создавая дубликат/orphan
  // блоб на каждую попытку, даже если сама загрузка байт уже успешно
  // прошла и не хватало только ответа на POST /chat/messages.
  describe('retry — переиспользует уже загруженные вложения, не льёт байты заново (finding #4)', () => {
    function attachFile(name = 'report.txt'): File {
      const file = new File(['content'], name, { type: 'text/plain' });
      const input = document.createElement('input');
      Object.defineProperty(input, 'files', { value: [file] });
      (window as any).onChatAttachmentPicked(input);
      return file;
    }

    it('"неопределённый результат POST" — ответ на успешную загрузку вложения потерян вместе с ответом на сам POST; retry НЕ перезаливает файл повторно', async () => {
      const { getChatMessages, postChatMessage, uploadChatAttachment } = setupGlobals();
      getChatMessages.mockResolvedValue({ items: [], nextCursor: null });
      uploadChatAttachment.mockResolvedValue({ id: 'att-uncertain-1' });
      postChatMessage.mockRejectedValueOnce(new Error('network lost')).mockResolvedValueOnce(msg({ id: '77', body: null }));
      await import('../src/pages/chat/index.js');
      (window as any).loadChatPage();
      await Promise.resolve();
      await Promise.resolve();

      attachFile();
      (window as any).sendChatMessage();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(uploadChatAttachment).toHaveBeenCalledTimes(1);
      // Ambiguous (network lost, без .definitive) — "Статус неизвестен", не "Не отправлено" (20.57.2).
      expect(document.getElementById('chatFeed')!.innerHTML).toContain('Статус неизвестен');

      const firstCallId = postChatMessage.mock.calls[0][1].clientMessageId;
      (window as any).retryChatMessage(firstCallId);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Байты вложения НЕ перезалиты — второй вызов postChatMessage несёт
      // тот же attachmentId, что и первый (переиспользован, не создан заново).
      expect(uploadChatAttachment).toHaveBeenCalledTimes(1);
      expect(postChatMessage.mock.calls[1][1].attachmentIds).toEqual(['att-uncertain-1']);
      expect(postChatMessage.mock.calls[1][1].clientMessageId).toBe(firstCallId);
    });

    it('сервер отвечает invalid_attachment (реально протухшее вложение) — retry ПЕРЕЗАЛИВАЕТ файл заново', async () => {
      const { getChatMessages, postChatMessage, uploadChatAttachment } = setupGlobals();
      getChatMessages.mockResolvedValue({ items: [], nextCursor: null });
      uploadChatAttachment.mockResolvedValueOnce({ id: 'att-stale-1' }).mockResolvedValueOnce({ id: 'att-fresh-2' });
      postChatMessage
        .mockRejectedValueOnce(Object.assign(new Error('Вложение недоступно'), { code: 'invalid_attachment', definitive: true }))
        .mockResolvedValueOnce(msg({ id: '78', body: null }));
      await import('../src/pages/chat/index.js');
      (window as any).loadChatPage();
      await Promise.resolve();
      await Promise.resolve();

      attachFile();
      (window as any).sendChatMessage();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(uploadChatAttachment).toHaveBeenCalledTimes(1);
      const firstCallId = postChatMessage.mock.calls[0][1].clientMessageId;

      (window as any).retryChatMessage(firstCallId);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Протухший id отброшен — файл реально перезалит, второй POST несёт
      // НОВЫЙ attachmentId, не старый.
      expect(uploadChatAttachment).toHaveBeenCalledTimes(2);
      expect(postChatMessage.mock.calls[1][1].attachmentIds).toEqual(['att-fresh-2']);
    });
  });

  // Hotfix 20.57.1 PASS 2, finding #5 — object URL created for download was
  // never released (leak). URL.revokeObjectURL() must be called after the
  // download has been initiated.
  it('downloadChatAttachment — освобождает object URL после инициации скачивания (finding #5)', async () => {
    const { getChatMessages, getChatAttachment } = setupGlobals();
    getChatMessages.mockResolvedValue({
      items: [msg({ body: null, attachments: [{ id: 'att-1', originalFilename: 'file.txt', sizeBytes: 10 }] })],
      nextCursor: null
    });
    await import('../src/pages/chat/index.js');
    (window as any).loadChatPage();
    await Promise.resolve();
    await Promise.resolve();

    getChatAttachment.mockResolvedValue(new Blob(['data']));
    const createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    const revokeObjectURL = vi.fn();
    (window as any).URL.createObjectURL = createObjectURL;
    (window as any).URL.revokeObjectURL = revokeObjectURL;

    const btn = document.getElementById('chatFeed')!.querySelector('.chat-attachment') as HTMLElement;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
