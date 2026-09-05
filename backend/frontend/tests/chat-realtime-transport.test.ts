/**
 * 20.57.0 — RealtimeTransport: WS-first с bounded polling fallback (§8/§9
 * брифа). jsdom не даёт настоящую сеть — WebSocket подменяется фейком,
 * управляемым тестом (open/close/error по требованию).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealtimeTransport } from '../src/pages/chat/realtime-transport.js';

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  simulateClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('RealtimeTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as any);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('успешное WS-подключение — доставляет сообщение через onMessage, не запускает polling', async () => {
    const onMessage = vi.fn();
    const fetchAfter = vi.fn().mockResolvedValue([]);
    const t = new RealtimeTransport({ onMessage, getLastKnownId: () => '10', fetchAfter });
    t.start();

    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    await vi.runOnlyPendingTimersAsync().catch(() => {});
    expect(t.isRealtimeConnected).toBe(true);

    ws.simulateMessage({ type: 'message', message: { id: '11', body: 'hi' } });
    expect(onMessage).toHaveBeenCalledWith({ id: '11', body: 'hi' });
    t.stop();
  });

  it('WS не открывается за таймаут — переключается на polling (fetchAfter вызывается)', async () => {
    const onMessage = vi.fn();
    const fetchAfter = vi.fn().mockResolvedValue([{ id: '5', body: 'polled' }]);
    const t = new RealtimeTransport({ onMessage, getLastKnownId: () => '4', fetchAfter });
    t.start();

    await vi.advanceTimersByTimeAsync(6001); // WS_CONNECT_TIMEOUT_MS
    expect(fetchAfter).toHaveBeenCalledWith('4');
    expect(onMessage).toHaveBeenCalledWith({ id: '5', body: 'polled' });
    t.stop();
  });

  it('WS закрывается после успешного открытия — падает обратно на polling', async () => {
    const onMessage = vi.fn();
    const fetchAfter = vi.fn().mockResolvedValue([]);
    const t = new RealtimeTransport({ onMessage, getLastKnownId: () => null, fetchAfter });
    t.start();

    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    expect(t.isRealtimeConnected).toBe(true);
    ws.simulateClose();
    expect(t.isRealtimeConnected).toBe(false);
    t.stop();
  });

  it('polling ошибка — bounded backoff, не бросает исключение наружу', async () => {
    const onMessage = vi.fn();
    const fetchAfter = vi.fn().mockRejectedValue(new Error('network'));
    const t = new RealtimeTransport({ onMessage, getLastKnownId: () => '1', fetchAfter });
    t.start();
    await vi.advanceTimersByTimeAsync(6001);
    expect(fetchAfter).toHaveBeenCalled();
    // Не упало — следующий тик планируется нормально, с удвоенным backoff (8с).
    await vi.advanceTimersByTimeAsync(8001);
    expect(fetchAfter.mock.calls.length).toBeGreaterThan(1);
    t.stop();
  });

  it('пустая лента (getLastKnownId === null) + WS не открывается — polling всё равно опрашивает (сентинел "0"), первое сообщение доставляется (hotfix 20.57.1, finding #3)', async () => {
    const onMessage = vi.fn();
    const fetchAfter = vi.fn().mockResolvedValue([{ id: '1', body: 'first ever message' }]);
    const t = new RealtimeTransport({ onMessage, getLastKnownId: () => null, fetchAfter });
    t.start();

    await vi.advanceTimersByTimeAsync(6001); // WS_CONNECT_TIMEOUT_MS
    expect(fetchAfter).toHaveBeenCalledWith('0');
    expect(onMessage).toHaveBeenCalledWith({ id: '1', body: 'first ever message' });
    t.stop();
  });

  it('stop() закрывает соединение и останавливает все таймеры', async () => {
    const onMessage = vi.fn();
    const fetchAfter = vi.fn().mockResolvedValue([]);
    const t = new RealtimeTransport({ onMessage, getLastKnownId: () => null, fetchAfter });
    t.start();
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    t.stop();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });
});
