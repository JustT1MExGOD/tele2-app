import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const __dirname = import.meta.dirname;

/** «Топы сотрудников» (20.75.0) — per-page build config, same shape as the rest. */
export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/pages/leaderboard/index.ts'),
      formats: ['iife'],
      name: '__t2LeaderboardPageBundle',
      fileName: () => 'pages/leaderboard.bundle.js'
    }
  }
});
