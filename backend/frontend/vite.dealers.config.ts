import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const __dirname = import.meta.dirname;

/** 21.x («максимально функциональный» admin) — per-page build config, same shape as the rest. */
export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/pages/dealers/index.ts'),
      formats: ['iife'],
      name: '__t2DealersPageBundle',
      fileName: () => 'pages/dealers.bundle.js'
    }
  }
});
