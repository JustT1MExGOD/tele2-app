import { defineConfig } from 'vitest/config';

// Real network calls to production/real infra — never run automatically
// by `npm test`/CI's default job. Invoke explicitly:
// `npm run test:network-acceptance`. See docs/DESKTOP-TESTING.md for the
// UNIT / INTEGRATION / NETWORK ACCEPTANCE / AFFECTED NETWORK ACCEPTANCE
// distinction.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['tests/network-acceptance/**/*.test.ts']
  }
});
