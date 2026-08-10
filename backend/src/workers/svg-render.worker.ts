/**
 * Рендер SVG→PNG (resvg) в отдельном потоке — см. services/svg-render-pool.ts
 * за тем, зачем: сам resvg синхронный и небыстрый (сотни мс на отчёт), а
 * отчёты шлются из cron несколько раз в день на каждую точку — раньше на
 * это время блокировался весь event loop главного процесса.
 */
import { parentPort } from 'node:worker_threads';

type RenderRequest = {
  id: number;
  svg: string;
  fitWidth: number;
  fontFiles: string[];
  defaultFontFamily: string;
};

parentPort?.on('message', async (req: RenderRequest) => {
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    const resvg = new Resvg(req.svg, {
      fitTo: { mode: 'width', value: req.fitWidth },
      font: { fontFiles: req.fontFiles, loadSystemFonts: true, defaultFontFamily: req.defaultFontFamily }
    });
    const png = Buffer.from(resvg.render().asPng());
    parentPort!.postMessage({ id: req.id, png });
  } catch (e: any) {
    parentPort!.postMessage({ id: req.id, error: e?.message || String(e) });
  }
});
