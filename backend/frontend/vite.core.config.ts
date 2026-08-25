import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const __dirname = import.meta.dirname;

/** 21.x (Frontend rewrite — final two files) — per-page build config, same shape as the rest. */
export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/app/core.ts'),
      formats: ['iife'],
      name: '__t2CoreBundle',
      fileName: () => 'app/core.bundle.js'
    }
  }
});
