import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const __dirname = import.meta.dirname;

/**
 * Библиотечный билд одного бандла, не полный переезд фронтенда на Vite
 * (20.0.0, Frontend Foundation — см. README §22 про масштаб пилота).
 *
 * Формат iife (не es/umd) — сознательный выбор: остальные 19 файлов
 * frontend/js/*.js — классические синхронные <script src=...> без
 * type="module", ожидающие, что всё нужное уже в глобальной области к
 * моменту их выполнения. IIFE сохраняет ту же семантику загрузки и не
 * ломает scripts/smoke-frontend.mjs, который матчит <script src="...">
 * жёстким regexp'ом без учёта type="module".
 */
export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/api-client.ts'),
      formats: ['iife'],
      name: '__t2ApiClientBundle',
      fileName: () => 'api-client.bundle.js'
    }
  }
});
