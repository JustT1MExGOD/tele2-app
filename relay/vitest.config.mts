import { defineConfig } from 'vitest/config';

// §3/§4 of the verification pass: the default suite (`npm test` / `npx
// vitest run`) must never depend on production, the public internet, or
// any third-party host — network-acceptance/** is excluded here and
// only runs via `npm run test:network-acceptance`
// (vitest.network-acceptance.config.ts), an explicit, separate command.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/network-acceptance/**', 'node_modules/**']
  }
});
