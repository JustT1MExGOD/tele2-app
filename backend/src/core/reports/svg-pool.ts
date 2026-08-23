/**
 * Пул воркеров для рендера SVG→PNG (resvg-js). Замерено: один рендер
 * отчёта — 350-400мс синхронной работы (native-биндинг, `resvg.render()`
 * блокирует поток целиком, `Promise.all` тут не спасает — событийный цикл
 * не свободен, пока resvg считает). Отчёты шлются из cron несколько раз в
 * день на каждую точку (микро- + итоговый, плюс story из 3 картинок разом)
 * — раньше на эти сотни мс-секунды сервер не мог обработать вообще ни
 * один HTTP-запрос. Рендер вынесен в worker_threads: главный процесс
 * остаётся отзывчивым, пока воркер считает картинку в своём потоке.
 */
import { Worker } from 'node:worker_threads';

const WORKER_URL = new URL('../../workers/svg-render.worker.js', import.meta.url);
const POOL_SIZE = 2;

type RenderPayload = {
  svg: string;
  fitWidth: number;
  fontFiles: string[];
  defaultFontFamily: string;
};

type PendingEntry = { resolve: (png: Buffer) => void; reject: (err: Error) => void };

class RenderWorker {
  private worker: Worker;
  private pending = new Map<number, PendingEntry>();
  private nextId = 1;

  constructor() {
    this.worker = new Worker(WORKER_URL);
    this.worker.on('message', (msg: { id: number; png?: Uint8Array; error?: string }) => {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error));
      else entry.resolve(Buffer.from(msg.png!));
    });
    this.worker.on('error', (err) => {
      // воркер упал целиком — не оставляем вызовы висеть вечно
      for (const entry of this.pending.values()) entry.reject(err);
      this.pending.clear();
    });
  }

  get load() {
    return this.pending.size;
  }

  render(payload: RenderPayload): Promise<Buffer> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...payload });
    });
  }
}

let pool: RenderWorker[] | null = null;

function getPool(): RenderWorker[] {
  if (!pool) pool = Array.from({ length: POOL_SIZE }, () => new RenderWorker());
  return pool;
}

/** Наименее загруженный воркер — простой баланс, достаточный для той пары
 * одновременных рендеров, что даёт story-отчёт (3 картинки разом). */
export async function renderSvgToPng(payload: RenderPayload): Promise<Buffer> {
  const workers = getPool();
  const worker = workers.reduce((a, b) => (b.load < a.load ? b : a));
  return worker.render(payload);
}
