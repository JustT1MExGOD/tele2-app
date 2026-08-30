import { defineConfig } from 'vitest/config';

// Real network calls to production — never run automatically. Invoke
// explicitly: `npm run test:network-acceptance`.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['tests/network-acceptance/**/*.test.ts']
  }
});
