import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const __dirname = import.meta.dirname;

/**
 * 21.x (Frontend rewrite continuation) — second per-page build config,
 * same shape and same reason as vite.pages.config.ts (reports.js, 20.12.0):
 * Rollup's iife output needs exactly one global namespace per build, so
 * each migrated page gets its own independent `vite build` invocation
 * rather than fighting that with code-splitting tricks. `emptyOutDir: false`
 * — chained after vite.config.ts and vite.pages.config.ts in build:frontend,
 * must not wipe out their output.
 */
export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/features/promos/index.ts'),
      formats: ['iife'],
      name: '__t2PromosBundle',
      fileName: () => 'features/promos.bundle.js'
    }
  }
});
