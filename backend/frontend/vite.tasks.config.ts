import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const __dirname = import.meta.dirname;

/**
 * 21.x (Frontend rewrite continuation) — seventh per-page build config,
 * same shape as the other migrated pages: Rollup's iife output needs
 * exactly one global namespace per build, so each migrated page gets its
 * own independent `vite build` invocation. `emptyOutDir: false` —
 * chained last in build:frontend, must not wipe out earlier output.
 */
export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/pages/tasks/index.ts'),
      formats: ['iife'],
      name: '__t2TasksPageBundle',
      fileName: () => 'pages/tasks.bundle.js'
    }
  }
});
