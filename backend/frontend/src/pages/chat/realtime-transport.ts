/**
 * RealtimeTransport (§8/§9 брифа) — WebSocket, если доступен, HTTP-polling
 * как bounded fallback. Не пытается заранее угадать DIRECT/RELAY: Electron
 * RELAY сегодня — чисто request/response `POST /forward`
 * (desktop/src/main/network/relay-client.ts, см. итоговый отчёт), поэтому
 * попытка открыть `wss://` в этом режиме либо не проходит через
 * перехватчик вообще (`session.protocol.handle('https', …)` не трогает
 * `wss:`-схему), либо подключение просто не устанавливается — оба случая
 * здесь выглядят одинаково: bounded таймаут на открытие, после него —
 * тихий переход на polling. Тот же код работает в браузере, Electron
 * DIRECT/RELAY и Telegram Mini App без единой ветки "а где мы сейчас" —
 * это НАМЕРЕННОЕ упрощение по сравнению с явным опросом network mode.
 *
 * REST остаётся источником истины (§8): WS/polling только сообщают "есть
 * новое", canonical-контент всегда приходит тем же ChatMessage-объектом,
 * что и из GET/POST /chat/messages — дедупликация на стороне вызывающего
 * кода (index.ts) по message.id работает одинаково для обоих транспортов.
 */
import type { ChatMessage } from '../../../../src/shared/api-types.js';

const WS_CONNECT_TIMEOUT_MS = 6000;
const WS_RETRY_BASE_MS = 5000;
const WS_RETRY_MAX_MS = 60000;
const POLL_INTERVAL_MS = 4000;
const POLL_BACKOFF_MAX_MS = 30000;

export interface RealtimeTransportOptions {
  onMessage(msg: ChatMessage): void;
  /** Последний известный canonical id — polling и WS-reconnect catch-up
   * запрашивают именно "что новее этого". null, если лента ещё пустая. */
  getLastKnownId(): string | null;
  fetchAfter(afterId: string): Promise<ChatMessage[]>;
}

export class RealtimeTransport {
  private opts: RealtimeTransportOptions;
  private ws: WebSocket | null = null;
  private stopped = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingActive = false;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private wsRetryDelay = WS_RETRY_BASE_MS;
  private pollDelay = POLL_INTERVAL_MS;
  private visibilityHandler = () => this.onVisibilityChange();

  constructor(opts: RealtimeTransportOptions) {
    this.opts = opts;
  }

  start(): void {
    this.stopped = false;
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.tryConnectWs();
  }

  stop(): void {
    this.stopped = true;
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
    }
  }

  get isRealtimeConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  private onVisibilityChange(): void {
    // Polling ставится на паузу, пока вкладка скрыта (§9 брифа: "не
    // создавать request storm") — при возврате сразу один немедленный тик
    // catch-up вместо ожидания следующего интервала.
    if (!document.hidden && this.pollingActive && !this.isRealtimeConnected) {
      this.pollTick();
    }
  }

  private tryConnectWs(): void {
    if (this.stopped) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}//${window.location.host}/chat/ws`);
    } catch {
      this.onWsUnavailable();
      return;
    }
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      this.onWsUnavailable();
    }, WS_CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      this.ws = ws;
      this.wsRetryDelay = WS_RETRY_BASE_MS;
      this.stopPolling();
      // Реальное соединение может пропустить всё, что случилось между
      // последним известным сообщением и открытием сокета — один
      // catch-up сразу после connect закрывает это окно (§8 брифа).
      this.pollTick();
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data?.type === 'message' && data.message) this.opts.onMessage(data.message as ChatMessage);
      } catch {
        /* игнорируем нераспознанный кадр — не роняем соединение */
      }
    };
    ws.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
      }
      if (this.ws === ws) this.ws = null;
      if (!this.stopped) {
        this.startPolling();
        this.scheduleWsRetry();
      }
    };
    ws.onerror = () => {
      // onclose всегда следует за onerror для WebSocket — вся логика
      // восстановления там, здесь просто не даём необработанной ошибке
      // прервать выполнение.
    };
  }

  private onWsUnavailable(): void {
    if (this.ws) return; // на случай гонки с уже успевшим open
    this.startPolling();
    this.scheduleWsRetry();
  }

  private scheduleWsRetry(): void {
    if (this.stopped || this.wsRetryTimer) return;
    this.wsRetryTimer = setTimeout(() => {
      this.wsRetryTimer = null;
      this.wsRetryDelay = Math.min(this.wsRetryDelay * 1.5, WS_RETRY_MAX_MS);
      this.tryConnectWs();
    }, this.wsRetryDelay);
  }

  /** Первый тик — сразу, не через полный интервал: WS только что не
   * получился (таймаут/close), заставлять ждать ещё POLL_INTERVAL_MS до
   * первой попытки catch-up было бы лишней задержкой без причины. */
  private startPolling(): void {
    if (this.pollingActive) return;
    this.pollingActive = true;
    this.pollDelay = POLL_INTERVAL_MS;
    void this.pollTick();
  }

  private stopPolling(): void {
    this.pollingActive = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private schedulePoll(): void {
    if (this.stopped || !this.pollingActive) return;
    this.pollTimer = setTimeout(() => this.pollTick(), this.pollDelay);
  }

  /** Вызывается и как шаг рекуррентного polling-цикла (через schedulePoll),
   * и разово как WS-reconnect catch-up (ws.onopen) — второй случай не
   * должен запускать/продолжать сам цикл, поэтому реcouplerescheduling в
   * конце гейтится pollingActive, а не самим фактом вызова этой функции. */
  private async pollTick(): Promise<void> {
    if (this.stopped) return;
    if (document.hidden && !this.isRealtimeConnected) {
      // Не шлём запрос, пока вкладка скрыта — просто переставляем таймер
      // на следующую проверку; onVisibilityChange разбудит немедленно.
      this.schedulePoll();
      return;
    }
    // '0' — валидный keyset-курсор (chat_messages.id — bigserial, начинается
    // с 1), означает "всё с начала", тот же bounded LIMIT, что и обычный
    // afterId. Без этого сентинела пустая лента (getLastKnownId() === null)
    // никогда не опрашивалась вообще — первое сообщение не появлялось до
    // ручного перезагрузки страницы (hotfix 20.57.1, finding #3).
    const afterId = this.opts.getLastKnownId() ?? '0';
    try {
      const items = await this.opts.fetchAfter(afterId);
      for (const item of items) this.opts.onMessage(item);
      this.pollDelay = POLL_INTERVAL_MS; // успех — сбрасываем backoff
    } catch {
      // Bounded backoff — не долбим сервер чаще при недоступности сети.
      this.pollDelay = Math.min(this.pollDelay * 2, POLL_BACKOFF_MAX_MS);
    }
    if (this.pollingActive && !this.isRealtimeConnected) this.schedulePoll();
  }
}
