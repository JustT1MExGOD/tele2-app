import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const __dirname = import.meta.dirname;

/** 21.x (Frontend rewrite continuation, batch of 13) — per-page build config, same shape as the rest. */
export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/pages/network-admin/index.ts'),
      formats: ['iife'],
      name: '__t2NetworkAdminPageBundle',
      fileName: () => 'pages/network-admin.bundle.js'
    }
  }
});
