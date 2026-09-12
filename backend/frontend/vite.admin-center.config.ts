import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const __dirname = import.meta.dirname;

/**
 * Admin Control Center (20.59.0) — own per-page build config, same shape
 * as every other migrated page (Rollup's iife output needs exactly one
 * global namespace per build). `emptyOutDir: false` — chained in the
 * middle of build:frontend, must not wipe out earlier output.
 */
export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/pages/admin-center/index.ts'),
      formats: ['iife'],
      name: '__t2AdminCenterPageBundle',
      fileName: () => 'pages/admin-center.bundle.js'
    }
  }
});
