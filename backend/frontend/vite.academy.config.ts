import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const __dirname = import.meta.dirname;

/**
 * T2 Academy — deliberately NOT listed in index.html's eager <script> tags
 * (unlike vite.tutorial.config.ts's OLD tutorial bundle). Loaded on demand
 * via app/core.ts's loadAcademyBundle() stub, injected as a <script> tag
 * only when the user actually opens the Academy — keeps the normal app
 * boot from paying for Academy code on every page load.
 */
export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/features/tutorial/academy-entry.ts'),
      formats: ['iife'],
      name: '__t2AcademyBundle',
      fileName: () => 'features/academy.bundle.js'
    }
  }
});
