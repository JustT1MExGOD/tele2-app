import { defineConfig } from 'vitest/config';

// §3/§4 of the verification pass: the default suite must not depend on
// production/the public internet — network-acceptance/** is excluded
// here and only runs via `npm run test:network-acceptance`.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/network-acceptance/**', 'node_modules/**']
  }
});
