import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const __dirname = import.meta.dirname;

/**
 * 20.12.0 (Frontend rewrite kickoff) — separate config from vite.config.ts
 * (which builds api-client.ts) because Rollup's iife/umd output formats
 * don't support multiple entries in one build (each iife bundle needs
 * exactly one global namespace) — so each migrated page gets its own
 * independent `vite build` invocation here rather than fighting that
 * constraint with code-splitting tricks. `emptyOutDir: false` — this build
 * runs after vite.config.ts's (see package.json's build:frontend) and must
 * not wipe out api-client.bundle.js.
 *
 * Same iife rationale as vite.config.ts: the rest of frontend/js/*.js are
 * classic <script src=...> without type="module", sharing one global
 * scope — iife preserves that loading semantics and keeps
 * scripts/smoke-frontend.mjs's <script src="..."> regexp working.
 */
export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/pages/reports/index.ts'),
      formats: ['iife'],
      name: '__t2ReportsPageBundle',
      fileName: () => 'pages/reports.bundle.js'
    }
  }
});
