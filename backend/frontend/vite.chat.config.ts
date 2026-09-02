import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const __dirname = import.meta.dirname;

/**
 * 20.57.0 — внутренний чат сотрудников, тот же shape, что и остальные
 * per-page build config'и (см. vite.tasks.config.ts): один независимый
 * `vite build` на страницу, iife-бандл в свой глобальный неймспейс.
 */
export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/pages/chat/index.ts'),
      formats: ['iife'],
      name: '__t2ChatPageBundle',
      fileName: () => 'pages/chat.bundle.js'
    }
  }
});
